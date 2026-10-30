import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { ZcaService } from '../../third-party/zalo/zalo-client'
import QuickMessageService from './services/implements/quick-message-service'

test('quick messages: newest first, duplicate keyword refused, editing keeps the photo, other devices refetch', async () => {
  const photo = { items: [{ type: 0, photoId: 5, thumbUrl: 't', rawUrl: 'r' }] }
  let items = [
    { id: 1, keyword: 'chao', type: 0, message: { title: 'Xin chào', params: '' }, media: null, lastModified: 10 },
    { id: 2, keyword: 'stk', type: 1, message: { title: '', params: '' }, media: photo, lastModified: 20 },
    { id: 3, keyword: 'x', type: 7, message: { title: '?' }, media: null, lastModified: 30 },
  ]
  const nexoraGet = mock(async (p: { url: string; params: Record<string, unknown> }) => (p.url.endsWith('/list') ? { items } : ''))
  const api = { zpwServiceMap: { quick_message: ['https://qm'] }, getContext: () => ({ imei: 'imei' }), nexoraGet }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  const quick = new QuickMessageService(zca)
  const calls = () => nexoraGet.mock.calls.map((c) => c[0])

  expect(await quick.list('me')).toEqual({
    items: [
      { id: '2', keyword: 'stk', title: '', photo: 't', lastModified: 20 },
      { id: '1', keyword: 'chao', title: 'Xin chào', photo: null, lastModified: 10 },
    ],
    max: 50,
  })
  await expect(quick.create('me', { keyword: 'chao', title: 'khác' })).rejects.toThrow('Phím tắt đã được sử dụng')

  await quick.update('me', '2', { keyword: 'stk2', title: 'Ảnh' })
  expect(calls().at(-1)).toEqual({ url: 'https://qm/api/quickmessage/update', params: { itemId: 2, keyword: 'stk2', message: { title: 'Ảnh', params: '' }, media: photo, type: 1 } })

  await quick.create('me', { keyword: 'moi', title: 'Mới' })
  expect(calls().at(-1)).toEqual({ url: 'https://qm/api/quickmessage/create', params: { keyword: 'moi', message: { title: 'Mới', params: '' }, type: 0, imei: 'imei' } })

  const lists = () => calls().filter((c) => c.url.endsWith('/list')).length
  // a change refetches once, then the list is kept
  await quick.list('me')
  const before = lists()
  await quick.list('me')
  expect(lists()).toBe(before)
  items = []
  zca.emit('control', 'me', { act_type: 'quick_message', act: 'delete', data: { items: [1, 2], version: 3 } })
  expect((await quick.list('me')).items).toEqual([])
  expect(lists()).toBe(before + 1)
})
