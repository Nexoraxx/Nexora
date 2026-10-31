import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { openDatabase, upsert } from '../../dbs/sqlite'
import type { ZcaService } from '../../third-party/zalo/zalo-client'
import type IMessageService from '../messages/services/interfaces/message-service'
import { CreateTodoRequest } from './dtos/requests/todo.request'
import TodoRepository from './repositories/implements/todo-repository'
import TodoService from './services/implements/todo-service'

type Call = { url: string; params: Record<string, unknown> }

test('todos: verify pages, only mine, my status; create sends the anchor first and PC params', async () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  upsert(db, 'user', [
    { accountId: 'me', userId: 'a', displayName: 'An', alias: 'An béo' },
    { accountId: 'me', userId: 'b', displayName: 'Bình' },
  ])
  upsert(db, 'groups', [{ accountId: 'me', userId: 'g1', displayName: 'Dự án', avatar: 'g.jpg' }])
  upsert(db, 'message', [{ accountId: 'me', msgId: '800', cliMsgId: '1600', toUid: 'g1', fromUid: 'a', msgType: 'chat.photo', sendDttm: 1, mentions: [{ uid: 'me', pos: 0, len: 3 }] }])

  const pages: Record<string, unknown> = {
    '': {
      scrollId: 's1',
      updated: [
        // mine, self-assigned and not received yet: shows "Đã nhận"
        { id: 't1', creator: 'me', assignees: [{ uid: 'me', status: -1 }], content: 'Viết', extra: { toUid: 'a', isGroup: false, msgId: '701' }, updateTime: 100 },
        // from An: the 1-1 is with An; a JSON string extra keeps its 19-digit msgId
        { id: 't2', creator: 'a', assignees: '[{"userId":"me","status":-1}]', description: 'Báo cáo', extra: '{"toUid":"me","isGroup":false,"msgId":7000000000000000002}', updateTime: 300 },
        { id: 't3', creator: 'b', assignees: [{ userId: 'a', status: 1 }], watchers: ['me'], status: 0, extra: { toUid: 'g1', isGroup: true }, updateTime: 200 },
        // not mine
        { id: 't4', creator: 'a', assignees: [{ userId: 'b', status: 0 }], extra: { toUid: 'b' }, updateTime: 400 },
        { id: 't6', creator: 'me', assignees: ['b'], extra: { toUid: 'b' }, updateTime: 10 },
      ],
    },
    // a deletion newer than the todo drops it, an older one doesn't
    s1: { scrollId: 's2', updated: [], deleted: [{ id: 't6', ts: 20 }, { id: 't1', ts: 50 }] },
    s2: { scrollId: 's3', updated: [], deleted: [] },
  }
  let feature = 0
  const order: string[] = []
  const nexoraGet = mock(async ({ params }: Call) => pages[params.scrollId as string])
  const nexoraPost = mock(async (_: Call) => (order.push('create'), { id: 't9' }))
  const api = {
    zpwServiceMap: { boards: ['https://board'] },
    getContext: () => ({ imei: 'imei', settings: { features: { task_setting: { enable_feature: feature } } } }),
    nexoraGet,
    nexoraPost,
  }
  // the listener echo stores the sent message with its clientId
  const sendText = mock(async (accountId: string, threadId: string, _req: { text: string }) => {
    order.push('send')
    upsert(db, 'message', [{ accountId, msgId: '900', cliMsgId: '1700', toUid: threadId, fromUid: accountId, msgType: 'webchat', sendDttm: 2 }])
    return { msgId: '900' }
  })
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  const todos = new TodoService(new TodoRepository(db), zca, { sendText } as unknown as IMessageService)

  // PC's default task_setting: off, nothing fetched
  expect(await todos.list('me')).toEqual({ enabled: false, todos: [] })
  expect(todos.isEnabled('me')).toBe(false)
  expect(nexoraGet).not.toHaveBeenCalled()

  feature = 1
  expect(todos.isEnabled('me')).toBe(true)
  const { enabled, todos: list } = await todos.list('me')
  expect(enabled).toBe(true)
  expect(nexoraGet.mock.calls.map(([c]) => [c.url, c.params.scrollId, c.params.lastUpdatedTime])).toEqual([
    ['https://board/api/board/personal/todo/verify', '', 0],
    ['https://board/api/board/personal/todo/verify', 's1', 0],
    ['https://board/api/board/personal/todo/verify', 's2', 0],
  ])
  expect(list.map((t) => t.id)).toEqual(['t2', 't3', 't1'])
  expect(list[0]).toMatchObject({ title: 'Báo cáo', status: -1, creator: { name: 'An béo' }, thread: { threadId: 'a', isGroup: false, name: 'An béo' }, msgId: '7000000000000000002' })
  expect(list[1]).toMatchObject({ status: 0, watchers: ['me'], thread: { threadId: 'g1', isGroup: true, name: 'Dự án', avatar: 'g.jpg' }, msgId: null })
  expect(list[2]).toMatchObject({ status: 0, assignees: [{ userId: 'me', status: 0 }], thread: { threadId: 'a' }, msgId: '701', dueDate: -1 })

  // from the editor: the content goes to the thread first and anchors the todo; nobody picked = me, "Chưa nhận"
  expect(await todos.create('me', CreateTodoRequest.parse({ threadId: 'a', isGroup: false, content: ' Báo cáo ', title: 'Tuần' }))).toEqual({ id: 't9' })
  expect(order).toEqual(['send', 'create'])
  expect(sendText.mock.calls[0]).toEqual(['me', 'a', { text: 'Báo cáo' }])
  const sent = nexoraPost.mock.calls[0][0]
  expect(sent).toMatchObject({
    url: 'https://board/api/board/personal/todo/create',
    params: { assignees: '["me"]', dueDate: -1, content: 'Báo cáo', description: 'Tuần', dateDefaultType: 0, status: -1, watchers: '[]', schedule: null, src: 5, imei: 'imei' },
  })
  expect(JSON.parse(sent.params.extra as string)).toEqual({ toUid: 'a', isGroup: false, msgId: '900', cliMsgId: '1700', msgType: 1, mention: [], ownerMsgUId: 'me', message: 'Báo cáo' })

  // "Giao việc" on a message: anchored on it, text cut as PC does, "Đã nhận" when I picked myself
  const due = Date.now() + 3_600_000
  await todos.create('me', CreateTodoRequest.parse({ threadId: 'g1', isGroup: true, msgId: '800', content: 'x'.repeat(2100), assignees: ['me', 'b'], dueDate: due }))
  expect(sendText).toHaveBeenCalledTimes(1)
  const fromMsg = nexoraPost.mock.calls[1][0].params
  expect(fromMsg).toMatchObject({ assignees: '["me","b"]', dueDate: due, dateDefaultType: 5, status: 0, src: 2 })
  expect(fromMsg.content).toBe(`${'x'.repeat(1997)}...`)
  expect(JSON.parse(fromMsg.extra as string)).toEqual({ toUid: 'g1', isGroup: true, msgId: '800', cliMsgId: '1600', msgType: 32, mention: [{ uid: 'me', pos: 0, len: 3 }], ownerMsgUId: 'a' })
  expect(() => CreateTodoRequest.parse({ threadId: 'a', isGroup: false, content: 'x', dueDate: Date.now() - 1 })).toThrow('Vui lòng chọn ngày giờ trong tương lai')
})
