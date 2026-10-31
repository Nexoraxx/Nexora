import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { GroupEventType, GroupMessage, Reactions, ThreadType, UserMessage, type GroupEvent, type Reaction, type TGroupMessage, type TMessage } from '@hwqnq/zca-js'
import { openDatabase } from '../../dbs/sqlite'
import type { ZcaService } from '../../third-party/zalo/zalo-client'
import type IContactService from '../contacts/services/interfaces/contact-service'
import type IConversationService from '../conversations/services/interfaces/conversation-service'
import MessageRepository from './repositories/implements/message-repository'
import MessageService from './services/implements/message-service'
import { SendMessageRequest } from './dtos/requests/message.request'
import type { E2eeService, E2eeState } from '../../third-party/signal/e2ee-service'
import type { Decrypted } from '../../third-party/signal/e2ee-message-receiver'

const ME = 'me'
const raw = (msgId: string, from: string, to: string, content: unknown = `text ${msgId}`) =>
  ({ actionId: msgId, msgId, cliMsgId: `c${msgId}`, msgType: 'webchat', uidFrom: from, idTo: to, dName: from, ts: msgId, content, ttl: 0, st: 0, at: 0, cmd: 0 }) as unknown as TMessage
const dm = (msgId: string, from = 'u1') => new UserMessage(ME, raw(msgId, from === ME ? '0' : from, from === ME ? 'u1' : '0'))
const gm = (msgId: string, from = 'u2') => new GroupMessage(ME, raw(msgId, from === ME ? '0' : from, 'g1') as TGroupMessage)
const reaction = (id: string, from: string, msgId: string, icon: string) =>
  ({ threadId: 'u1', data: { msgId: id, actionId: id, uidFrom: from, ts: id, content: { rMsg: [{ gMsgID: msgId, cMsgID: 'c' + msgId }], rIcon: icon, rType: icon ? 0 : -1 } } }) as unknown as Reaction
const tick = () => Bun.sleep(5)

const setup = () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  db.run(`INSERT INTO groups (accountId, userId, displayName) VALUES ('me', 'g1', 'Nhóm')`)
  const requestOldMessages = mock()
  const api = {
    listener: { requestOldMessages, requestOldReactions: mock() },
    getLastMessages: mock(async () => ({ msgs: [raw('100', 'u3', '0')], groupMsgs: [], clearUnreads: [{ idTo: 'u3', lastMsgId: '100', isGroup: 0 }] })),
    getLastSeenMessages: mock(async () => []),
    sendMessage: mock(async () => ({ message: { msgId: 500 }, attachment: [] })),
    sendSeenEvent: mock(async () => ({ status: 0 })),
    sendDeliveredEvent: mock(async () => ''),
    addReaction: mock(async () => ({ msgIds: [900] })),
    getGroupCloudMessages: mock(async () => ({ groupMsgs: [gm('5'), gm('6')], hasMore: 0, lastMsgId: '5' })),
    getContext: () => ({ settings: {}, imei: 'i', language: 'vi' }),
    undoMany: mock(async () => ''),
    forwardMessage: mock(async (_: unknown, ids: string[], _type?: ThreadType) => ({ success: ids.map((threadId) => ({ threadId })), fail: [] })),
    sendSticker: mock(async () => ({ msgId: 1 })),
    sendLink: mock(async () => ({ msgId: 1 })),
    sendCard: mock(async () => ({ msgId: 1 })),
    custom: mock((name: string, cb: (p: unknown) => unknown) => Object.assign(api, { [name]: (props: unknown) => cb({ ctx: { imei: 'i' }, utils: forwardUtils, props }) })),
    getQR: mock(async (): Promise<Record<string, string>> => {
      throw new Error('no qr')
    }),
    parseLink: mock(async () => ({ data: { href: 'https://x.vn/a', title: 'T'.repeat(90), desc: 'D', thumb: 'th', src: 'x.vn', media: { type: 0 } }, error_maps: {} as Record<string, number> })),
    getTrendingGifs: mock(async () => ({ data_list: [{ id: 1, original: { url: 'o', width: 2, height: 3 }, normal: { url: 'n' } }, { id: 2, original: { url: 'o2', width: 2, height: 3 } }] })),
    searchGif: mock(async () => ({ data_list: [] })),
  }
  const forwardUtils = {
    encodeAES: (s: string) => s,
    makeURL: (u: string) => u,
    request: mock(async (url: string, init: { method?: string; body?: URLSearchParams }) => ({ url, params: JSON.parse(init.body!.get("params")!) })),
    resolve: async (r: unknown) => r,
  }
  Object.assign(api, { zpwServiceMap: { file: ['https://file'], chat: ['https://chat'], group: ['https://group'], chat_e2e: ['https://e2e'] } })
  const zca = Object.assign(new EventEmitter(), { get: () => api, has: () => true }) as unknown as ZcaService
  const contacts = { ensureKnown: async () => false, refreshGroup: mock(async () => {}), forgetGroup: mock(() => {}) }
  const ttls: Record<string, number> = {}
  const conversations = { ttl: (_: string, threadId: string) => ttls[threadId] ?? 0 }
  // E2EE stand-in: per-thread state, decryption by cliMsgId
  const states: Record<string, E2eeState> = {}
  const decrypted: Record<string, Decrypted> = {}
  const e2ee = Object.assign(new EventEmitter(), {
    state: (_: string, id: string) => states[id] ?? 'off',
    decrypt: mock(async (_: string, m: { cliMsgId: string }) => decrypted[m.cliMsgId] ?? {}),
    sendText: mock(async () => ({ msgId: '600', cliMsgId: 'c600', content: 'kín' })),
    sendSticker: mock(async () => ({ msgId: '601', cliMsgId: 'c601', content: { id: 1, catId: 2, type: 7 } })),
    sendGif: mock(async () => ({ msgId: '602', cliMsgId: 'c602', content: { href: 'g', thumb: 't', width: 1, height: 1, type: 0 } })),
    enable: mock(async (): Promise<'complete' | 'pending'> => 'pending'),
  })
  const messages = new MessageService(db, new MessageRepository(db), zca, contacts as unknown as IContactService, conversations as unknown as IConversationService, e2ee as unknown as E2eeService)
  return { db, api, zca, contacts, ttls, forwardUtils, e2ee, states, decrypted, messages }
}
const thread = (s: MessageService, id: string) => s.threads(ME, 50).find((t) => t.threadId === id)

test('live and offline messages: preview, unread without double counting, offline paging by actionId, recalls', async () => {
  const { zca, api, messages } = setup()
  zca.emit('message', ME, dm('10'))
  zca.emit('message', ME, dm('11'))
  await tick()
  expect(thread(messages, 'u1')).toMatchObject({ msgId: '11', unread: 2, content: 'text 11', isGroup: false })

  // offline batch overlaps what came live: still 3 unread, then the next page is requested from actionId 12
  zca.emit('old_messages', ME, [dm('11'), dm('12')], ThreadType.User)
  await tick()
  expect(thread(messages, 'u1')?.unread).toBe(3)
  expect(api.listener.requestOldMessages).toHaveBeenLastCalledWith(ThreadType.User, '12')
  api.listener.requestOldMessages.mockClear()
  zca.emit('old_messages', ME, [], ThreadType.User)
  await tick()
  expect(api.listener.requestOldMessages).not.toHaveBeenCalled()

  // own reply from another device marks the thread read
  zca.emit('message', ME, dm('13', ME))
  await tick()
  expect(thread(messages, 'u1')).toMatchObject({ unread: 0, msgId: '13' })

  // recall carried inside an offline batch, and as a live undo event
  zca.emit('old_messages', ME, [dm('14'), new UserMessage(ME, raw('15', 'u1', '0', { deleteMsg: 1, globalMsgId: 14, cliMsgId: 1, srcId: 1, destId: 1 }))], ThreadType.User)
  await tick()
  expect((await messages.history(ME, 'u1', undefined, 50)).messages.find((m) => m.msgId === '14')).toMatchObject({ msgType: 'chat.undo', content: null })
  expect(thread(messages, 'u1')?.unread).toBe(0)
})

test('reactions are idempotent per event id; our own echo is not counted twice; receipts merge', async () => {
  const { zca, messages } = setup()
  zca.emit('message', ME, dm('10', ME))
  await tick()
  zca.emit('reaction', ME, reaction('20', 'u1', '10', Reactions.HEART))
  zca.emit('reaction', ME, reaction('20', 'u1', '10', Reactions.HEART))
  zca.emit('reaction', ME, reaction('21', 'u1', '10', Reactions.HEART))
  await tick()
  await messages.react(ME, 'u1', '10', Reactions.LIKE)
  zca.emit('reaction', ME, reaction('900', ME, '10', Reactions.LIKE))
  await tick()
  const [msg] = (await messages.history(ME, 'u1', undefined, 50)).messages
  expect(msg.reactions).toEqual([
    { icon: Reactions.HEART, count: 2, mine: false },
    { icon: Reactions.LIKE, count: 1, mine: true },
  ])

  zca.emit('reaction', ME, reaction('22', 'u1', '10', ''))
  zca.emit('delivered_messages', ME, [{ type: ThreadType.User, threadId: 'u1', data: { msgId: '10', deliveredUids: ['u1'], seenUids: [] } } as never])
  zca.emit('seen_messages', ME, [{ type: ThreadType.User, threadId: 'u1', data: { msgId: '10', idTo: 'u1' } } as never])
  await tick()
  const [after] = (await messages.history(ME, 'u1', undefined, 50)).messages
  expect(after.reactions).toEqual([{ icon: Reactions.LIKE, count: 1, mine: true }])
  expect(after).toMatchObject({ deliveredUids: ['u1'], seenUids: ['u1'] })
})

test('sending stores the message at once and the echo completes it; seen clears unread; groups page from the cloud', async () => {
  const { zca, api, messages } = setup()
  zca.emit('message', ME, gm('7'))
  await tick()
  expect(thread(messages, 'g1')).toMatchObject({ isGroup: true, name: 'Nhóm', unread: 1 })

  await messages.markSeen(ME, 'g1')
  expect(api.sendSeenEvent).toHaveBeenCalledWith(expect.objectContaining({ msgId: '7', idTo: 'g1' }), ThreadType.Group)
  expect(thread(messages, 'g1')?.unread).toBe(0)

  const { msgId } = await messages.sendText(ME, 'g1', { text: 'xin chào', quoteMsgId: '7' })
  expect(api.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ msg: 'xin chào', quote: expect.objectContaining({ msgId: '7' }) }), 'g1', ThreadType.Group)
  expect(thread(messages, 'g1')).toMatchObject({ msgId: '500', content: 'xin chào', unread: 0 })
  zca.emit('message', ME, new GroupMessage(ME, { ...raw('500', '0', 'g1', 'xin chào'), ts: '8' } as TGroupMessage))
  await tick()

  // local has 2 messages, asking for 50 pulls older ones from the group cloud
  const { messages: page, hasMore } = await messages.history(ME, 'g1', undefined, 50)
  expect(api.getGroupCloudMessages).toHaveBeenCalledWith('g1', { msgId: '7', direction: 'old', count: 50 })
  expect(page.map((m) => m.msgId)).toEqual(['5', '6', '7', msgId!])
  expect(page.at(-1)).toMatchObject({ cliMsgId: 'c500', fromUid: ME })
  expect(hasMore).toBe(false)

  // Zalo refusing the cloud ("Lỗi không xác định") must not hide local history
  api.getGroupCloudMessages.mockImplementationOnce(async () => {
    throw new Error('Lỗi không xác định')
  })
  expect((await messages.history(ME, 'g1', undefined, 50)).messages.map((m) => m.msgId)).toEqual(['5', '6', '7', msgId!])
  // the same request again within 10s (receipt refetches) stays local, as PC
  api.getGroupCloudMessages.mockClear()
  expect((await messages.history(ME, 'g1', undefined, 50)).messages).toHaveLength(4)
  expect(api.getGroupCloudMessages).not.toHaveBeenCalled()
})

test('preload stores last messages and applies read markers from other devices', async () => {
  const { zca, api, messages } = setup()
  zca.emit('attached', ME, api as never)
  await tick()
  expect(api.getLastMessages).toHaveBeenCalledWith([])
  expect(thread(messages, 'u3')).toMatchObject({ msgId: '100', unread: 0 })
})

test('media lists photos/videos, files and link cards of one thread, newest first', async () => {
  const { zca, messages } = setup()
  const typed = (msgId: string, msgType: string, content: unknown) => new UserMessage(ME, { ...raw(msgId, 'u1', '0'), msgType, content, idTo: '0' } as unknown as TMessage)
  for (const m of [
    typed('1', 'chat.photo', { href: 'p1' }),
    typed('2', 'share.file', { title: 'a.pdf' }),
    typed('3', 'chat.recommended', { action: 'recommened.link', href: 'https://x' }),
    typed('4', 'chat.recommended', { action: 'recommened.user' }),
    typed('5', 'chat.video.msg', { href: 'v1' }),
  ])
    zca.emit('message', ME, m)
  await tick()
  expect(messages.media(ME, 'u1', 'media', 10).map((m) => m.msgId)).toEqual(['5', '1'])
  expect(messages.media(ME, 'u1', 'file', 10)).toMatchObject([{ msgId: '2', content: { title: 'a.pdf' } }])
  expect(messages.media(ME, 'u1', 'link', 10).map((m) => m.msgId)).toEqual(['3'])
  expect(messages.media(ME, 'u1', 'media', 1).map((m) => m.msgId)).toEqual(['5'])
})

test('group events become system messages in the thread, never unread, and refetch the group', async () => {
  const { db, zca, contacts, messages } = setup()
  db.run(`INSERT INTO user (accountId, userId, displayName) VALUES ('me', 'u2', 'Hai')`)
  zca.emit('message', ME, gm('100'))
  await tick()
  const event = { type: GroupEventType.UPDATE, act: 'update', threadId: 'g1', isSelf: false, data: { groupId: 'g1', sourceId: 'u2', groupName: 'Lớp 12', time: '1790000000000', updateMembers: [] } }
  zca.emit('group_event', ME, event as unknown as GroupEvent)
  zca.emit('group_event', ME, event as unknown as GroupEvent)
  await tick()
  expect(thread(messages, 'g1')).toMatchObject({ unread: 1, msgType: 'group.noti', fromUid: null })
  const { messages: rows } = await messages.history(ME, 'g1', undefined, 50)
  expect(rows.filter((m) => m.msgType === 'group.noti')).toMatchObject([{ msgId: '1790000000000', fromUid: null, content: 'Hai đổi tên nhóm thành "Lớp 12"' }])
  expect(contacts.refreshGroup).toHaveBeenCalledWith(ME, 'g1')
})

test('leaving a group from any device drops it and its conversation instead of refetching it', async () => {
  const { db, zca, contacts, messages } = setup()
  zca.emit('message', ME, gm('100'))
  await tick()
  const left = { type: GroupEventType.LEAVE, act: 'leave', threadId: 'g1', isSelf: true, data: { groupId: 'g1', sourceId: ME, time: '1790000000000', updateMembers: [{ id: ME, dName: 'Tôi' }] } }
  zca.emit('group_event', ME, left as unknown as GroupEvent)
  await tick()
  expect(thread(messages, 'g1')).toBeUndefined()
  expect(contacts.forgetGroup).toHaveBeenCalledWith(ME, 'g1')
  expect(contacts.refreshGroup).not.toHaveBeenCalled()
})

test('search: tone- and punctuation-blind phrase with a prefix last word, sender and time filters; jump loads to the newest', async () => {
  const { zca, messages } = setup()
  zca.emit('message', ME, dm('10', 'u1'))
  zca.emit('message', ME, new UserMessage(ME, raw('11', 'u1', '0', 'Đi ăn phở không?')))
  zca.emit('message', ME, new UserMessage(ME, raw('12', '0', 'u1', 'đi ăn phở bò nhé')))
  zca.emit('message', ME, new UserMessage(ME, raw('13', 'u1', '0', 'ăn cơm')))
  await tick()
  const ids = (q: Record<string, unknown>) => messages.search(ME, 'u1', { limit: 20, offset: 0, ...q } as never).map((m) => m.msgId)
  expect(ids({ q: 'di an PHO' })).toEqual(['12', '11'])
  expect(ids({ q: 'ăn ph' })).toEqual(['12', '11'])
  expect(ids({ q: 'phở, bò!' })).toEqual(['12'])
  expect(ids({ q: 'ăn', fromUid: ME })).toEqual(['12'])
  expect(ids({ q: 'ăn', since: 11 })).toEqual(['13', '12'])
  expect(ids({ q: '!!!' })).toEqual([])
  const { messages: jumped } = await messages.history(ME, 'u1', undefined, 30, '11')
  expect(jumped.map((m) => m.msgId)).toEqual(['11', '12', '13'])
})

test('auto-delete: sends carry the thread ttl; expired messages are purged and the preview falls back; stars are local', async () => {
  const { zca, api, ttls, messages } = setup()
  const now = Date.now()
  zca.emit('message', ME, new UserMessage(ME, { ...raw(String(now - 10), 'u1', '0', 'cũ'), ts: String(now - 10_000) } as unknown as TMessage))
  // the newest message, already past its ttl
  zca.emit('message', ME, new UserMessage(ME, { ...raw(String(now), 'u1', '0', 'hết hạn'), ts: String(now - 5000), ttl: 1000 } as unknown as TMessage))
  await tick()
  expect(thread(messages, 'u1')?.content).toBe('cũ')
  ttls.u1 = 3_600_000
  await messages.sendText(ME, 'u1', { text: 'tự xóa' })
  expect(api.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ ttl: 3_600_000 }), 'u1', ThreadType.User)
  expect((await messages.history(ME, 'u1', undefined, 50)).messages.map((m) => m.content)).toEqual(['cũ', 'tự xóa'])

  messages.star(ME, String(now - 10), true)
  // starredAt: "Tất cả" merges several accounts' lists on it
  expect(messages.starred(ME)).toMatchObject([{ msgId: String(now - 10), starred: true, starredAt: expect.any(Number) }])
  messages.star(ME, String(now - 10), false)
  expect(messages.starred(ME)).toEqual([])
})

test('recall: own recent messages only, at most 50, one multi_undo for many', async () => {
  const { zca, api, messages } = setup()
  const now = Date.now()
  const at = (msgId: string, from: string, ts: number) => new UserMessage(ME, { ...raw(msgId, from === ME ? '0' : from, from === ME ? 'u1' : '0'), ts: String(ts) } as unknown as TMessage)
  zca.emit('message', ME, at('20', ME, now))
  zca.emit('message', ME, at('21', ME, now))
  zca.emit('message', ME, at('22', 'u1', now))
  zca.emit('message', ME, at('23', ME, now - 301_000))
  await tick()
  await expect(messages.undoMany(ME, 'u1', ['20', '22'])).rejects.toThrow('Chỉ thu hồi được tin nhắn của bạn')
  await expect(messages.undoMany(ME, 'u1', ['23'])).rejects.toThrow('Bạn chỉ có thể thu hồi tin nhắn trong vòng 5 phút')
  await expect(messages.undoMany(ME, 'u1', Array.from({ length: 51 }, () => '20'))).rejects.toThrow('nhiều hơn 50')
  await messages.undoMany(ME, 'u1', ['20', '21'])
  expect(api.undoMany).toHaveBeenCalledWith([{ msgId: '20', cliMsgId: 'c20' }, { msgId: '21', cliMsgId: 'c21' }], 'u1', ThreadType.User)
  const rows = (await messages.history(ME, 'u1', undefined, 50)).messages
  expect(rows.filter((m) => m.msgType === 'chat.undo').map((m) => m.msgId)).toEqual(['20', '21'])
})

test('forward: text batches per type and ttl; files reuse the upload via /forward with the receiver ttl; stickers resend', async () => {
  const { zca, api, ttls, forwardUtils, messages } = setup()
  const typed = (msgId: string, msgType: string, content: unknown) => new UserMessage(ME, { ...raw(msgId, 'u1', '0'), msgType, content } as unknown as TMessage)
  zca.emit('message', ME, dm('30'))
  zca.emit('message', ME, typed('31', 'share.file', { title: 'a.pdf', href: 'https://f/a', params: '{"fileSize":"9","checksum":"abc","fileExt":"pdf","fType":1}' }))
  zca.emit('message', ME, typed('32', 'chat.sticker', { id: 5, catId: 6, type: 7 }))
  await tick()
  ttls.u9 = 86_400_000
  await messages.forward(ME, 'u1', '30', ['u8', 'u9', 'g1'])
  expect(api.forwardMessage.mock.calls.map(([p, ids, type]) => [(p as { ttl: number }).ttl, ids, type])).toEqual([
    [0, ['u8'], ThreadType.User],
    [86_400_000, ['u9'], ThreadType.User],
    [0, ['g1'], ThreadType.Group],
  ])
  const r = await messages.forward(ME, 'u1', '31', ['u9', 'g1'])
  expect(r.fail).toEqual([])
  expect(forwardUtils.request.mock.calls.map(([url, init]) => [url, JSON.parse(init.body!.get('params')!)])).toMatchObject([
    ['https://file/api/message/forward', { toId: 'u9', ttl: 86_400_000, msgType: 1 }],
    ['https://file/api/group/forward', { grid: 'g1', ttl: 0, msgType: 1 }],
  ])
  expect(JSON.parse(JSON.parse(forwardUtils.request.mock.calls[0][1].body!.get('params')!).msgInfo)).toEqual({ url: 'https://f/a', fileName: 'a.pdf', extension: 'pdf', checksum: 'abc', size: 9, fType: 1 })
  await messages.forward(ME, 'u1', '32', ['u8'])
  expect(api.sendSticker).toHaveBeenCalledWith({ id: 5, cateId: 6, type: 7 }, 'u8', ThreadType.User)
})

test('cards go out through /forward even when QR codes fail, with the phone as 0xxx when asked', async () => {
  const { db, forwardUtils, messages } = setup()
  db.run(`INSERT INTO user (accountId, userId, displayName, phoneNumber) VALUES ('me', 'f1', 'Bạn', '84912345678')`)
  await messages.sendCards(ME, 'g1', { userIds: ['f1', 'f2'], withPhone: true })
  const sent = forwardUtils.request.mock.calls.map(([url, init]) => [url, JSON.parse(init.body!.get('params')!)])
  expect(sent).toMatchObject([
    ['https://file/api/group/forward', { grid: 'g1', msgType: 6 }],
    ['https://file/api/group/forward', { grid: 'g1', msgType: 6 }],
  ])
  expect(sent.map(([, p]) => JSON.parse(p.msgInfo))).toEqual([{ contactUid: 'f1', qrCodeUrl: '', phone: '0912345678' }, { contactUid: 'f2', qrCodeUrl: '' }])
})

test('link preview keeps the typed URL and cuts the title; a ready preview sends one link message with the whole text', async () => {
  const { api, forwardUtils, messages } = setup()
  const preview = (await messages.linkPreview(ME, 'x.vn/a'))!
  expect(preview).toMatchObject({ href: 'https://x.vn/a', title: 'T'.repeat(80), thumb: 'th' })
  api.parseLink.mockImplementationOnce(async () => ({ data: { href: 'h', title: 'only title', desc: '', thumb: '', src: '', media: { type: 0 } }, error_maps: {} }))
  expect(await messages.linkPreview(ME, 'https://y.vn')).toBeNull()
  await messages.sendLink(ME, 'u1', { text: 'xem x.vn/a nhé', preview })
  const [url, init] = forwardUtils.request.mock.calls[0]
  expect(url).toBe('https://chat/api/message/link')
  expect(JSON.parse(init.body!.get('params')!)).toMatchObject({ msg: 'xem x.vn/a nhé', href: 'https://x.vn/a', toId: 'u1', mentionInfo: '', language: 'vi', type: 0 })
})

test('GIFs: trending first page of 50 without unusable items; sending puts params on the query string', async () => {
  const { api, forwardUtils, messages } = setup()
  expect(await messages.gifs(ME, '#a', 0)).toEqual([{ id: '1', url: 'o', thumb: 'n', width: 2, height: 3 }])
  expect(api.getTrendingGifs).toHaveBeenCalledWith(0, 50)
  await messages.gifs(ME, 'mèo', 10)
  expect(api.searchGif).toHaveBeenCalledWith('mèo', 10, 10)
  forwardUtils.makeURL = ((u: string, q?: Record<string, string>) => (q ? `${u}?params=${q.params}` : u)) as typeof forwardUtils.makeURL
  forwardUtils.request.mockImplementationOnce((async (url: string) => ({ url })) as never)
  await messages.sendGif(ME, 'u1', { id: '1', url: 'o', thumb: 'n', width: 2, height: 3 })
  const [url, init] = forwardUtils.request.mock.calls[0]
  expect(url.startsWith('https://file/api/message/gif?params=')).toBe(true)
  expect(JSON.parse(url.split('params=')[1])).toMatchObject({ toid: 'u1', href: 'o', thumb: 'n', contentId: '1', src: 1, type: 0 })
  expect(init).toEqual({ method: 'POST' })
})

test('formatted text: PC style codes pass validation, go to zca as given, and are stored as rtf content', async () => {
  const { api, messages } = setup()
  const req = SendMessageRequest.parse({ text: 'Đỏ đậm', styles: [{ start: 0, len: 2, st: 'b,c_db342e' }, { start: 3, len: 3, st: 'f_20' }] })
  expect(() => SendMessageRequest.parse({ text: 'x', styles: [{ start: 0, len: 1, st: 'c_red;x' }] })).toThrow()
  await messages.sendText(ME, 'u1', req)
  expect(api.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ styles: req.styles }), 'u1', ThreadType.User)
  const [row] = (await messages.history(ME, 'u1', undefined, 50)).messages
  expect(row.content).toEqual({ action: 'rtf', title: 'Đỏ đậm', params: JSON.stringify({ styles: req.styles, ver: 0 }) })
})

test('"Cloud của tôi" pages from the cloud as PC (isOA: 1) yet stays a 1-1 conversation', async () => {
  const { api, messages } = setup()
  const note = (id: string) => new GroupMessage(ME, { ...raw(id, '0', 'cloud', 'ghi chú'), ts: id } as TGroupMessage)
  Object.assign(api, { getContext: () => ({ settings: {}, imei: 'i', language: 'vi', loginInfo: { send2me_id: 'cloud' } }) })
  api.getGroupCloudMessages.mockImplementationOnce(async () => ({ groupMsgs: [note('3'), note('4')], hasMore: 0, lastMsgId: '3' }) as never)

  const { messages: page } = await messages.history(ME, 'cloud', undefined, 50)
  expect(api.getGroupCloudMessages).toHaveBeenCalledWith('cloud', { msgId: '0', direction: 'recent', count: 50, isOA: true })
  expect(page.map((m) => m.msgId)).toEqual(['3', '4'])
  expect(thread(messages, 'cloud')).toMatchObject({ isGroup: false })
})

test('end-to-end encrypted messages (cmd 551) are kept as chat.e2ee, out of search', async () => {
  const { zca, messages } = setup()
  const cipher = 'AzMIlAMSIQUZJqd4T6O6Ehfg'
  zca.emit('message', ME, new UserMessage(ME, { ...raw('40', 'u1', '0', cipher), cmd: 551 } as TMessage))
  await tick()
  const [m] = (await messages.history(ME, 'u1', undefined, 50)).messages
  expect(m).toMatchObject({ msgType: 'chat.e2ee', content: cipher })
  expect(thread(messages, 'u1')).toMatchObject({ msgType: 'chat.e2ee' })
  expect(messages.search(ME, 'u1', { q: cipher, limit: 20, offset: 0 } as never)).toEqual([])
})

test('E2EE messages: a decrypted one is stored as its own type and searchable, a failed one stays chat.e2ee with its state', async () => {
  const { zca, api, forwardUtils, decrypted, messages } = setup()
  decrypted.c41 = { status: 3000, content: 'Xin chào bí mật', quote: { ownerId: 'me', msg: 'gốc' } }
  decrypted.c42 = { status: 3001 }
  const e2eeMsg = (id: string) => new UserMessage(ME, { ...raw(id, 'u1', '0', 'AzMIlAMS'), cmd: 551, paramsExt: { platformType: 2 } } as TMessage)
  zca.emit('message', ME, e2eeMsg('41'))
  zca.emit('message', ME, e2eeMsg('42'))
  await tick()
  const rows = (await messages.history(ME, 'u1', undefined, 50)).messages
  expect(rows.map((m) => [m.msgId, m.msgType, m.content, m.e2eeStatus])).toEqual([
    ['41', 'webchat', 'Xin chào bí mật', 3000],
    ['42', 'chat.e2ee', 'AzMIlAMS', 3001],
  ])
  expect(rows[0].quote).toEqual({ ownerId: 'me', msg: 'gốc' })
  expect(messages.search(ME, 'u1', { q: 'bí mật', limit: 20, offset: 0 } as never).map((m) => m.msgId)).toEqual(['41'])

  // PC's delivered: a decrypted one on the E2EE service with the sending device, a failed one as a plain message
  await Bun.sleep(550)
  const [url, init] = forwardUtils.request.mock.calls.find(([u]) => u.includes('/e2ee/'))!
  expect(url).toBe('https://e2e/api/e2ee/pc/t/message/delivered')
  expect(JSON.parse(JSON.parse(init.body!.get('params')!).msgInfos)).toEqual({ seen: 0, data: [{ cmi: 'c41', gmi: '41', si: 'u1', di: '0', mt: 'webchat', st: 0, at: 0, cmd: 551, ts: '41', fDI: 2 }] })
  expect(api.sendDeliveredEvent.mock.calls.map((c) => (c as unknown[])[1])).toMatchObject([[{ msgId: '42' }]])
})

test('an E2EE message from the offline queue (transport cmd 513) is decrypted and stored, not left as raw ciphertext', async () => {
  const { e2ee, decrypted, messages } = setup()
  decrypted.c70 = { status: 3000, content: 'tin offline đã mã hoá' }
  // the E2EE offline queue carries its transport cmd (513), not the message cmd (551)
  e2ee.emit('messages', ME, [{ ...raw('70', 'u1', '0', 'CIPHER70'), cmd: 513, paramsExt: { platformType: 2 } }])
  await tick()
  const [m] = (await messages.history(ME, 'u1', undefined, 50)).messages
  expect(m).toMatchObject({ msgId: '70', msgType: 'webchat', content: 'tin offline đã mã hoá', e2eeStatus: 3000 })
})

test('repair: a message the offline bug left as raw ciphertext (cmd 513) is healed from the deciphered cache on preload', async () => {
  const { db, zca, api, messages } = setup()
  db.run(`INSERT INTO message (accountId, msgId, cliMsgId, toUid, fromUid, msgType, sendDttm, message, cmd, e2eeStatus) VALUES ('me','80','c80','u1','u1','chat.photo',1000,?,513,3000)`, [
    JSON.stringify({ href: 'https://x.jpg?e2esession=CIPHER', title: '' }),
  ])
  db.run(`INSERT INTO e2ee_deciphered (accountId, key, content, ts) VALUES ('me','c80_u1',?,1)`, [JSON.stringify({ content: { href: 'https://x.jpg?e2esession=REALKEY', title: 'ảnh bí mật' } })])
  zca.emit('attached', ME, api as never)
  await tick()
  const [m] = (await messages.history(ME, 'u1', undefined, 50)).messages
  expect(m).toMatchObject({ msgId: '80', msgType: 'chat.photo', e2eeStatus: 3000 })
  expect(m.content).toEqual({ href: 'https://x.jpg?e2esession=REALKEY', title: 'ảnh bí mật' })
})

test('text to an encrypted conversation goes out end-to-end encrypted, stored under the ids it was sent with; its echo is not stored again', async () => {
  const { zca, api, e2ee, states, decrypted, messages } = setup()
  states.u1 = 'on'
  const req = SendMessageRequest.parse({ text: 'kín', styles: [{ start: 0, len: 3, st: 'b' }] })
  expect(await messages.sendText(ME, 'u1', req)).toEqual({ msgId: '600' })
  expect(e2ee.sendText).toHaveBeenCalledWith(ME, api, 'u1', 'kín', req.styles)
  expect(api.sendMessage).not.toHaveBeenCalled()
  decrypted.c600 = { status: 3006 }
  zca.emit('message', ME, new UserMessage(ME, { ...raw('600', '0', 'u1', 'cipher'), cmd: 551 } as TMessage))
  await tick()
  const [row] = (await messages.history(ME, 'u1', undefined, 50)).messages
  expect(row).toMatchObject({ msgId: '600', cliMsgId: 'c600', fromUid: ME, msgType: 'webchat', content: 'kín', e2eeStatus: 3000 })
})

test('nothing reaches an encrypted conversation as plaintext: replies and other types are refused, forwards fail, an unknown state waits', async () => {
  const { zca, api, e2ee, states, messages } = setup()
  zca.emit('message', ME, dm('30'))
  await tick()
  states.u1 = 'on'
  await expect(messages.sendText(ME, 'u1', SendMessageRequest.parse({ text: 'a', quoteMsgId: '30' }))).rejects.toThrow('mã hóa đầu cuối')
  // stickers go out end-to-end encrypted, never as plaintext
  await messages.sendSticker(ME, 'u1', { id: 1, cateId: 2, type: 7 })
  expect(e2ee.sendSticker).toHaveBeenCalledWith(ME, api, 'u1', { id: 1, catId: 2, type: 7 })
  expect(api.sendSticker).not.toHaveBeenCalled()
  const r = await messages.forward(ME, 'u1', '30', ['u1', 'u8'])
  expect(r.fail).toEqual([expect.objectContaining({ threadId: 'u1' })])
  expect(api.forwardMessage).toHaveBeenCalledWith(expect.anything(), ['u8'], ThreadType.User)
  states.u9 = 'pending'
  await expect(messages.sendText(ME, 'u9', SendMessageRequest.parse({ text: 'a' }))).rejects.toThrow('thử lại')
  expect(api.sendMessage).not.toHaveBeenCalled()
})

test("E2EE messages from the offline queue and the preload are decrypted; the thread list shows which conversations are encrypted", async () => {
  const { db, zca, api, e2ee, decrypted, messages } = setup()
  decrypted.c70 = { status: 3000, content: 'lúc offline' }
  decrypted.c71 = { status: 3000, content: 'preload' }
  e2ee.emit('messages', ME, [{ ...raw('70', 'u5', '0', 'cipher'), cmd: 551 }])
  api.getLastMessages.mockImplementationOnce(async () => ({ msgs: [{ ...raw('71', 'u6', '0', 'cipher'), cmd: 551 }], groupMsgs: [], clearUnreads: [] }) as never)
  zca.emit('attached', ME, api as never)
  db.run(`INSERT INTO e2ee_metadata (accountId, uid, status) VALUES ('me', 'u5', 1)`)
  await tick()
  expect([thread(messages, 'u5'), thread(messages, 'u6')].map((t) => [t?.content, t?.e2ee])).toEqual([
    ['lúc offline', true],
    ['preload', false],
  ])
})

test("turning E2EE on, as PC: only for a friend's 1-1 chat that isn't blocked; Zalo's failures come back in PC's words", async () => {
  const { db, e2ee, messages } = setup()
  db.run(`INSERT INTO user (accountId, userId, displayName, isFr, isBlocked) VALUES ('me', 'f1', 'Bạn A', 1, 0), ('me', 'f2', 'Bạn B', 1, 1)`)
  await expect(messages.enableE2ee(ME, 'g1')).rejects.toThrow('trò chuyện 2 người')
  await expect(messages.enableE2ee(ME, 'u1')).rejects.toThrow('Tính năng hiện không khả dụng')
  await expect(messages.enableE2ee(ME, 'f2')).rejects.toThrow('bỏ chặn')
  expect(e2ee.enable).not.toHaveBeenCalled()
  expect(await messages.enableE2ee(ME, 'f1')).toEqual({ status: 'pending' })
  expect(e2ee.enable).toHaveBeenCalledWith(ME, 'f1')
  e2ee.enable.mockImplementationOnce(async () => {
    throw Object.assign(new Error('x'), { code: 'NO_DEVICE' })
  })
  await expect(messages.enableE2ee(ME, 'f1')).rejects.toThrow('Bạn A không nằm trong danh sách thử nghiệm tính năng Mã hóa đầu cuối')
  e2ee.enable.mockImplementationOnce(async () => {
    throw Object.assign(new Error('x'), { code: 'timeout' })
  })
  await expect(messages.enableE2ee(ME, 'f1')).rejects.toThrow('Hãy kiểm tra lại kết nối mạng và thử lại')
})

test("Zalo's GET_BUNDLE refusals when turning E2EE on read as PC's: which side has to update or sign in again", async () => {
  const { db, e2ee, messages } = setup()
  db.run(`INSERT INTO user (accountId, userId, displayName, isFr, isBlocked) VALUES ('me', 'f1', 'Bạn A', 1, 0)`)
  const refuse = (error: object) =>
    e2ee.enable.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), error)
    })
  refuse({ code: -2 })
  await expect(messages.enableE2ee(ME, 'f1')).rejects.toThrow('Bạn A không nằm trong danh sách thử nghiệm')
  refuse({ code: -3 })
  await expect(messages.enableE2ee(ME, 'f1')).rejects.toThrow('Bạn A cần cập nhật phiên bản Zalo mới')
  refuse({ code: -9, errData: [{ uid: 'f1', deviceId: 1 }, { uid: ME, deviceId: 2 }, { uid: ME, deviceId: 0 }] })
  await expect(messages.enableE2ee(ME, 'f1')).rejects.toThrow('Hãy đăng nhập lại Zalo trên điện thoại, Zalo PC và thử nâng cấp lại')
})

test("Zalo's E2EE blacklist (-10, -11) reads as PC's \"not available with this user\"", async () => {
  const { db, e2ee, messages } = setup()
  db.run(`INSERT INTO user (accountId, userId, displayName, isFr, isBlocked) VALUES ('me', 'f1', 'Bạn A', 1, 0)`)
  for (const code of [-10, -11]) {
    e2ee.enable.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { code, errData: [] })
    })
    await expect(messages.enableE2ee(ME, 'f1')).rejects.toThrow('Tính năng hiện không khả dụng với người dùng này')
  }
})
