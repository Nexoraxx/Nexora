import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { openDatabase } from '../../dbs/sqlite'
import type { ZcaService } from '../../third-party/zalo/zalo-client'
import PinRepository from './repositories/implements/pin-repository'
import PinService from './services/implements/pin-service'

const setup = () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  db.run(`INSERT INTO groups (accountId, userId, displayName, creatorId) VALUES ('me', 'g1', 'Nhóm', 'boss')`)
  db.run(`INSERT INTO group_info (accountId, userId, adminIds, setting) VALUES ('me', 'g1', '["dep"]', '{"setTopicOnly":0}')`)
  db.run(`INSERT INTO message (accountId, msgId, cliMsgId, toUid, fromUid, dName, msgType, sendDttm, message, msgText) VALUES
    ('me', '10', 'c10', 'g1', 'u2', 'Hai', 'webchat', 1, '"họp lúc 9h"', 'họp lúc 9h'),
    ('me', '11', 'c11', 'u1', 'u1', 'Một', 'chat.photo', 2, '{"href":"h","thumb":"t"}', '')`)
  const request = mock(async (url: string, init: { body?: URLSearchParams }) => ({ url, params: JSON.parse(init.body!.get('params')!) }))
  const utils = { encodeAES: (s: string) => s, makeURL: (u: string) => u, request, resolve: async (r: unknown) => r }
  const api: Record<string, unknown> = {
    zpwServiceMap: { group_board: ['https://board'] },
    getContext: () => ({ imei: 'i' }),
    custom: (name: string, cb: (p: unknown) => unknown) => (api[name] = (props: unknown) => cb({ utils, props })),
    getPinnedTopics: mock(async () => ({ items: [{ id: 7, type: 2, params: '{"global_msg_id":"9","client_msg_id":"c9","senderName":"Hai","title":"cũ","msg_type":1}', createTime: 5 }], boardVersion: 4, pinLimit: 1 })),
    unpinTopics: mock(async () => ({})),
    getFriendBoardList: mock(async () => ({ data: [], version: 2 })),
    createFriendBoardTopic: mock(async () => ({})),
  }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  return { db, api, request, pins: new PinService(new PinRepository(db), zca) }
}

test('group pins: list parses params; a full board drops the chosen pin first; createv2 pins the message as type 2', async () => {
  const { api, request, pins } = setup()
  expect(await pins.list('me', 'g1')).toEqual({
    limit: 1,
    pins: [{ topicId: '7', topicType: 2, msgId: '9', cliMsgId: 'c9', senderUid: null, senderName: 'Hai', title: 'cũ', msgType: 1, thumb: null, createTime: 5 }],
  })
  await pins.pin('me', 'g1', { msgId: '10', replace: { topicId: '7', topicType: 2 } })
  expect(api.unpinTopics).toHaveBeenCalledWith('g1', [{ topicId: '7', topicType: 2 }], 4)
  const [url, init] = request.mock.calls[0]
  expect(url).toBe('https://board/api/board/topic/createv2')
  const sent = JSON.parse(init.body!.get('params')!)
  expect(sent).toMatchObject({ grid: 'g1', type: 2, emoji: '📌', pinAct: 1, startTime: -1, duration: -1 })
  expect(JSON.parse(sent.params)).toEqual({ client_msg_id: 'c10', global_msg_id: '10', senderUid: 'u2', senderName: 'Hai', title: 'họp lúc 9h', msg_type: 1 })
})

test('setTopicOnly groups: only owner and deputies pin; 1-1 pins go to the friend board', async () => {
  const { db, api, pins } = setup()
  db.run(`UPDATE group_info SET setting = '{"setTopicOnly":1}'`)
  await expect(pins.pin('me', 'g1', { msgId: '10' })).rejects.toThrow('Chỉ trưởng/phó nhóm được phép ghim tin nhắn')
  db.run(`UPDATE group_info SET adminIds = '["me"]'`)
  await pins.pin('me', 'g1', { msgId: '10' })

  await pins.pin('me', 'u1', { msgId: '11' })
  expect(api.createFriendBoardTopic).toHaveBeenCalledWith(
    'u1',
    { type: 2, emoji: '🌄', params: { client_msg_id: 'c11', global_msg_id: '11', senderUid: 'u1', senderName: 'Một', title: '', msg_type: 32, thumb: 't', href: 'h' } },
    2,
  )
  expect((await pins.list('me', 'u1')).limit).toBe(3)
})
