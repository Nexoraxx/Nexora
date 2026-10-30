import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { openDatabase } from '../../dbs/sqlite'
import type { ZcaService } from '../../third-party/zalo/zalo-client'
import SearchRepository from './repositories/implements/search-repository'
import SearchService, { nameMatches } from './services/implements/search-service'

const setup = () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  db.run(`INSERT INTO user (accountId, userId, displayName, zaloName, alias, isFr) VALUES
    ('me', 'u1', 'Nguyễn Văn An', 'An', NULL, 1), ('me', 'u2', 'Trần Bình', 'Bình', 'Bình béo', 1), ('me', 'u3', 'Lạ', 'Lạ', NULL, 0)`)
  db.run(`INSERT INTO groups (accountId, userId, displayName) VALUES ('me', 'g1', 'Nhóm Ăn Vặt')`)
  const msg = (id: string, to: string, type: string, message: string, text: string) =>
    db.run(`INSERT INTO message (accountId, msgId, toUid, fromUid, msgType, sendDttm, message, msgText) VALUES ('me', ?, ?, 'u1', ?, ?, ?, ?)`, [id, to, type, Number(id), message, text])
  msg('1', 'u1', 'webchat', '"đi ăn phở"', 'đi ăn phở')
  msg('2', 'g1', 'webchat', '"ăn phở không"', 'ăn phở không')
  msg('3', 'g1', 'share.file', '{"title":"pho-menu.pdf"}', 'pho-menu.pdf')
  db.run(`INSERT INTO preview_message (accountId, convId, msgId, isGroup, messageTime) VALUES ('me', 'u1', '1', 0, 1), ('me', 'g1', '3', 1, 3)`)
  let list = { list_recent: [{ id: 'g1', type: 1 }], list_keyword: [{ key: 'phở' }], version: 4 }
  const api = {
    getRecentSearch: mock(async () => list),
    updateRecentSearch: mock(async (recent: unknown, version: number, keywords: unknown) => ((list = { list_recent: recent, list_keyword: keywords, version: version + 1 } as never), '')),
  }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  return { api, search: new SearchService(new SearchRepository(db), zca) }
}

test('names match when every keyword starts a different word, tones and case ignored', () => {
  expect(nameMatches(['Nguyễn Văn An'], 'an ng')).toBe(true)
  expect(nameMatches(['Nguyễn Văn An'], 'van an')).toBe(true)
  expect(nameMatches(['Nguyễn Văn An'], 'an an')).toBe(false)
  expect(nameMatches(['Nguyễn Văn An'], 'guyen')).toBe(false)
  expect(nameMatches([null, 'Đặng'], 'dang')).toBe(true)
})

test('global search: contacts by name / alias (strangers only when chatted with), messages and files apart', () => {
  const { search } = setup()
  const r = search.search('me', 'an')
  expect(r.contacts.map((c) => c.userId)).toEqual(['g1', 'u1'])
  expect(search.search('me', 'béo').contacts).toMatchObject([{ userId: 'u2', name: 'Bình béo', isFr: true }])
  expect(search.search('me', 'lạ').contacts).toEqual([])
  const pho = search.search('me', 'pho')
  expect(pho.messages.map((m) => [m.msgId, m.isGroup, m.threadName])).toEqual([
    ['2', true, 'Nhóm Ăn Vặt'],
    ['1', false, 'Nguyễn Văn An'],
  ])
  expect(pho.files.map((m) => m.msgId)).toEqual(['3'])
  expect(search.search('me', 'pho', new Set(['g1'])).messages.map((m) => m.msgId)).toEqual(['1'])
  // hidden: only under "Trò chuyện ẩn", by name or (unlocked by the PIN) all of them
  const hidden = search.search('me', 'an', new Set(['g1']))
  expect([hidden.contacts.map((c) => c.userId), hidden.hidden.map((c) => c.userId)]).toEqual([['u1'], ['g1']])
  expect(search.search('me', '1234', new Set(['u2']), true).hidden.map((c) => c.userId)).toEqual(['u2'])
})

test('recent searches come from Zalo; adding sends the whole list back with its version', async () => {
  const { api, search } = setup()
  expect(await search.recent('me')).toEqual({ contacts: [{ userId: 'g1', isGroup: true, name: 'Nhóm Ăn Vặt', avatar: null, isFr: false }], keywords: ['phở'] })
  await search.addRecent('me', { kind: 'contact', id: 'u1', isGroup: false })
  expect(api.updateRecentSearch.mock.calls[0][0]).toMatchObject([{ id: 'u1', type: 0 }, { id: 'g1', type: 1 }])
  expect(api.updateRecentSearch.mock.calls[0][1]).toBe(4)
  await search.removeRecent('me', { kind: 'keyword', key: 'phở' })
  expect((await search.recent('me')).keywords).toEqual([])
})
