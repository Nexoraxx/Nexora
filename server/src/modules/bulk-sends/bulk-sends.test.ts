import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { HTTPException } from 'hono/http-exception'
import { ZaloApiError } from '@hwqnq/zca-js'
import { openDatabase, upsert } from '../../dbs/sqlite'
import type { ZcaService } from '../../third-party/zalo/zalo-client'
import type IMessageService from '../messages/services/interfaces/message-service'
import { TemplateRequest } from './dtos/requests/bulk-send.request'
import BulkSendRepository from './repositories/implements/bulk-send-repository'
import BulkSendService from './services/implements/bulk-send-service'
import { missingIn, render, unknownVariables, valuesOf } from './services/implements/template'

test('template: English keys, spaces in braces, fallbacks, unknown keys', () => {
  const lan = valuesOf({ displayName: 'Lan Nguyễn', zaloName: 'lan', alias: 'Lan váy đỏ 0912', gender: 1, phoneNumber: '' }, 'Shop A')
  expect(render('Chào {{pronoun}} {{ name }}, em là {{me}}', lan)).toBe('Chào chị Lan Nguyễn, em là Shop A')
  expect(render('{{alias}} / {{phone}}.', lan)).toBe('Lan váy đỏ 0912 / .')
  expect(missingIn('{{phone}} {{name}} {{phone}}', lan)).toEqual(['phone'])

  // no gender: "anh/chị", and it counts as missing; no alias: the name; no display name: the Zalo name
  const nam = valuesOf({ displayName: null, zaloName: 'Nam', alias: null, gender: null, phoneNumber: '09' }, 'Shop A')
  expect(render('{{pronoun}} {{alias}} {{name}} {{phone}}', nam)).toBe('anh/chị Nam Nam 09')
  expect(missingIn('{{pronoun}}', nam)).toEqual(['pronoun'])
  expect(render('{{pronoun}}', valuesOf({ displayName: 'B', zaloName: null, alias: null, gender: 0, phoneNumber: null }, ''))).toBe('anh')

  expect(unknownVariables('{{nmae}} {{name}} {{ten}} {{nmae}}')).toEqual(['nmae', 'ten'])
  expect(() => TemplateRequest.parse({ name: 'x', body: 'Chào {{nmae}}' })).toThrow('Không có biến {{nmae}}')
  expect(TemplateRequest.parse({ name: ' x ', body: 'a\r\nb ' })).toEqual({ name: 'x', body: 'a\nb' })
})

const setup = () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'Shop A', 'i', '[]', 'ua', 1)`)
  upsert(db, 'user', [
    { accountId: 'me', userId: 'a', displayName: 'An', gender: 0, isFr: 1 },
    { accountId: 'me', userId: 'b', displayName: 'Bình', gender: 1, isFr: 1 },
    { accountId: 'me', userId: 'c', displayName: 'Chi', isFr: 1 },
    { accountId: 'me', userId: 'd', displayName: 'Dũng', phoneNumber: '0912', isFr: 1 },
    { accountId: 'me', userId: 'x', displayName: 'Lạ', isFr: 0 },
    { accountId: 'me', userId: 'y', displayName: 'Chặn', isFr: 1, isBlocked: 1 },
  ])
  const sent: { to: string; text: string }[] = []
  // per recipient: what the Zalo call does
  const outcome: Record<string, () => unknown> = {}
  const sendText = mock(async (_: string, to: string, req: { text: string }) => {
    outcome[to]?.()
    sent.push({ to, text: req.text })
    return { msgId: `m-${to}` }
  })
  let online = true
  const zca = Object.assign(new EventEmitter(), {
    get: () => {
      if (!online) throw new HTTPException(409, { message: 'Tài khoản chưa kết nối' })
      return {}
    },
  }) as unknown as ZcaService
  const repo = new BulkSendRepository(db)
  const make = () => {
    const s = new BulkSendService(repo, zca, { sendText } as unknown as IMessageService)
    s.sleep = async () => {}
    return s
  }
  return { db, repo, make, sent, outcome, setOnline: (v: boolean) => (online = v) }
}

// the loop runs detached: let it finish its turns
const settle = async () => {
  for (let i = 0; i < 50; i++) await Bun.sleep(1)
}
const states = (repo: BulkSendRepository, id: number) => Object.fromEntries(repo.recipients(id).map((r) => [r.userId, r.state]))

test('run: one at a time in picked order; Zalo errors fail, unclear ones are unknown; done at the end', async () => {
  const { repo, make, sent, outcome } = setup()
  const bulk = make()
  outcome.b = () => {
    throw new ZaloApiError('Người này không nhận tin nhắn từ người lạ', 114)
  }
  outcome.c = () => {
    throw new TypeError('fetch failed')
  }

  // preview: the texts, and who lacks a value the body uses
  const body = 'Chào {{pronoun}} {{name}}, {{me}} đây. SĐT {{phone}}'
  const preview = bulk.preview('me', { body, userIds: ['d', 'a', 'b', 'c'] })
  expect(preview.items.map((i) => i.text)).toEqual([
    'Chào anh/chị Dũng, Shop A đây. SĐT 0912',
    'Chào anh An, Shop A đây. SĐT ',
    'Chào chị Bình, Shop A đây. SĐT ',
    'Chào anh/chị Chi, Shop A đây. SĐT ',
  ])
  expect(preview.missing).toEqual({ pronoun: ['d', 'c'], phone: ['a', 'b', 'c'] })
  // not a friend, or blocked: refused rather than silently dropped
  expect(() => bulk.preview('me', { body, userIds: ['a', 'x'] })).toThrow(HTTPException)
  expect(() => bulk.preview('me', { body, userIds: ['a', 'y'] })).toThrow(HTTPException)

  const { id } = bulk.create('me', { name: 'Giục chốt đơn', body, userIds: ['d', 'a', 'b', 'c'] })
  await settle()
  expect(sent.map((s) => s.to)).toEqual(['d', 'a'])
  expect(states(repo, id)).toEqual({ d: 'sent', a: 'sent', b: 'failed', c: 'unknown' })
  expect(repo.recipients(id).find((r) => r.userId === 'b')?.error).toBe('Người này không nhận tin nhắn từ người lạ (mã 114)')
  expect(bulk.list('me')[0]).toMatchObject({ id, name: 'Giục chốt đơn', state: 'done', total: 4, sent: 2, failed: 1, pending: 0 })
})

test('run: 3 failures in a row pause it; offline pauses without spending anyone; resume picks up where it was', async () => {
  const { repo, make, sent, outcome, setOnline } = setup()
  const bulk = make()
  for (const u of ['a', 'b', 'c'])
    outcome[u] = () => {
      throw new ZaloApiError('Gửi quá nhanh', 221)
    }
  const { id } = bulk.create('me', { name: 't', body: 'Hi {{name}}', userIds: ['a', 'b', 'c', 'd'] })
  await settle()
  expect(states(repo, id)).toEqual({ a: 'failed', b: 'failed', c: 'failed', d: 'pending' })
  expect(bulk.list('me')[0]).toMatchObject({ state: 'paused', pauseReason: 'Dừng vì lỗi 3 lần liên tiếp: Gửi quá nhanh (mã 221)' })

  setOnline(false)
  bulk.resume('me', id)
  await settle()
  expect(states(repo, id).d).toBe('pending')
  expect(bulk.list('me')[0]).toMatchObject({ state: 'paused', pauseReason: 'Tài khoản chưa kết nối' })

  setOnline(true)
  bulk.resume('me', id)
  await settle()
  expect(sent).toEqual([{ to: 'd', text: 'Hi Dũng' }])
  expect(bulk.list('me')[0].state).toBe('done')
})

test('restart: a running run pauses, the send in flight becomes unknown and is never sent again', async () => {
  const { db, repo, make, sent } = setup()
  // as left by a process that died mid-call: 'a' sent, 'b' in flight, 'c' waiting
  const id = repo.create('me', 't', [
    { userId: 'a', text: '1' },
    { userId: 'b', text: '2' },
    { userId: 'c', text: '3' },
  ])
  repo.mark(id, 'a', 'sent')
  repo.mark(id, 'b', 'sending')
  const bulk = make()
  expect(states(repo, id)).toEqual({ a: 'sent', b: 'unknown', c: 'pending' })
  expect(bulk.list('me')[0]).toMatchObject({ state: 'paused', pauseReason: 'Nexora đã khởi động lại giữa chừng' })

  // one running run per account: a second can't start or resume beside it
  const other = repo.create('me', 'busy', [{ userId: 'd', text: '4' }])
  expect(() => bulk.create('me', { name: 'x', body: 'x', userIds: ['a'] })).toThrow('Tài khoản này đang có một đợt gửi khác đang chạy')
  expect(() => bulk.resume('me', id)).toThrow('Tài khoản này đang có một đợt gửi khác đang chạy')
  bulk.cancel('me', other)
  expect(states(repo, other)).toEqual({ d: 'skipped' })

  bulk.resume('me', id)
  await settle()
  expect(sent).toEqual([{ to: 'c', text: '3' }])
  expect(states(repo, id)).toEqual({ a: 'sent', b: 'unknown', c: 'sent' })
  // deleting the account takes its runs along
  db.run(`DELETE FROM account WHERE id = 'me'`)
  expect(repo.recipients(id)).toEqual([])
})
