import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { MuteAction, MuteDuration, ThreadType } from '@hwqnq/zca-js'
import { openDatabase } from '../../dbs/sqlite'
import type { ZcaService } from '../../third-party/zalo/zalo-client'
import ConversationRepository from './repositories/implements/conversation-repository'
import ConversationService from './services/implements/conversation-service'

test('pins and mutes load from Zalo with bare ids, expire, and follow changes', async () => {
  const now = Math.floor(Date.now() / 1000)
  const setMute = mock(async () => '')
  const api = {
    getPinConversations: async () => ({ conversations: ['u1', 'g2'], version: 1 }),
    getMute: async () => ({
      chatEntries: [
        { id: 'u5', duration: -1, startTime: now },
        { id: 'u6', duration: 60, startTime: now - 120 },
      ],
      groupChatEntries: [{ id: 'g7', duration: 3600, startTime: now }],
    }),
    getAutoDeleteChat: async () => ({ convers: [{ destId: 'g7', isGroup: true, ttl: 86_400_000, createdAt: 1 }, { destId: '8', isGroup: false, ttl: 0, createdAt: 1 }] }),
    setPinnedConversations: mock(async () => ''),
    setMute,
    updateAutoDeleteChat: mock(async () => ''),
  }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  const conversations = new ConversationService(zca, new ConversationRepository(openDatabase(':memory:')))

  zca.emit('attached', 'me', api as never)
  await Bun.sleep(0)
  const loaded = conversations.settings('me')
  expect(loaded.pinned).toEqual(['1', '2'])
  expect(Object.keys(loaded.muted).sort()).toEqual(['5', '7'])
  expect(loaded.muted['5']).toBe(-1)
  expect(loaded.ttl).toEqual({ '7': 86_400_000 })

  await conversations.setPinned('me', '2', true, false)
  expect(api.setPinnedConversations).toHaveBeenCalledWith(false, '2', ThreadType.Group)
  expect(conversations.settings('me').pinned).toEqual(['1'])

  await conversations.setMute('me', '9', { isGroup: false, duration: 'until8AM' })
  expect(setMute).toHaveBeenLastCalledWith({ duration: MuteDuration.UNTIL_8AM }, '9', ThreadType.User)
  expect(conversations.settings('me').muted['9']).toBeGreaterThan(Date.now())
  await conversations.setMute('me', '5', { isGroup: false, duration: null })
  expect(setMute).toHaveBeenLastCalledWith({ action: MuteAction.UNMUTE }, '5', ThreadType.User)
  expect(conversations.settings('me').muted['5']).toBeUndefined()

  await conversations.setAutoDelete('me', '3', { isGroup: false, ttl: 3_600_000 })
  expect(api.updateAutoDeleteChat).toHaveBeenLastCalledWith(3_600_000, '3', ThreadType.User)
  expect(conversations.ttl('me', '3')).toBe(3_600_000)
  await conversations.setAutoDelete('me', '3', { isGroup: false, ttl: 0 })
  expect(conversations.ttl('me', '3')).toBe(0)

  // changed on another device
  zca.emit('control', 'me', { act_type: 'conv_settings', act: 'update_ttl', data: JSON.stringify({ threadId: '3', isGroup: 0, ttl: 86_400_000 }) })
  expect(conversations.ttl('me', '3')).toBe(86_400_000)
  zca.emit('control', 'me', { act_type: 'conv_settings', act: 'update_ttl', data: { threadId: '3', isGroup: 0, ttl: 0 } })
  expect(conversations.ttl('me', '3')).toBe(0)

  // pins and mutes changed on another device
  zca.emit('control', 'me', { act_type: 'pinned_convers', act: 'update', data: JSON.stringify({ pinIds: ['u5', 'g9'], action: 1, ts: 1 }) })
  zca.emit('control', 'me', { act_type: 'pinned_convers', act: 'update', data: { pinIds: ['u1'], action: 0, ts: 2 } })
  expect(conversations.settings('me').pinned.sort()).toEqual(['5', '9'])
  const nowS = Math.floor(Date.now() / 1000)
  zca.emit('control', 'me', { act_type: 'mute', act: 'set', data: { toId: '11', duration: 3600, systemTime: nowS, muteType: 1 } })
  zca.emit('control', 'me', { act_type: 'mute', act: 'set', data: { toId: '12', duration: -1, systemTime: nowS, muteType: 2 } })
  zca.emit('control', 'me', { act_type: 'mute', act: 'set', data: { toId: '13', duration: 60, systemTime: nowS - 120, muteType: 1 } })
  zca.emit('control', 'me', { act_type: 'mute', act: 'unset', data: { toId: '7', muteType: 2 } })
  const muted = conversations.settings('me').muted
  expect(muted['11']).toBe((nowS + 3600) * 1000)
  expect(muted['12']).toBe(-1)
  expect('13' in muted || '7' in muted).toBe(false)
})

test('unread marks, "Khác", labels and hidden chats load (big ids intact), change and follow other devices', async () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  db.run(`INSERT INTO message (accountId, msgId, cliMsgId, toUid, fromUid, msgType, sendDttm) VALUES ('me', '9', 'c9', '7', 'me', 'webchat', 9)`)
  // replies of the bigint-safe GET, by path; posts recorded
  const gets: Record<string, unknown> = {
    '/api/conv/getUnreadMark': { data: '{"convsUser":[{"id":1035497930452690352}],"convsGroup":[]}' },
    '/api/archivedchat/list': { items: [{ id: '5', type: 0 }], version: 2 },
    '/api/convlabel/get': { labelData: '[{"id":1,"text":"Khách hàng","textKey":"","conversations":["g8"],"color":"#FF6905","offset":0,"emoji":"","createTime":1}]', version: 3 },
    '/api/hiddenconvers/get-all': { pin: '81dc9bdb52d04dc20036dbd8313ed055', threads: [{ thread_id: '6', is_group: 0 }] },
  }
  const posts: { path: string; params: Record<string, unknown> }[] = []
  const api: Record<string, unknown> = {
    zpwServiceMap: { conversation: ['c'], label: ['l'] },
    getContext: () => ({ imei: 'i' }),
    custom: (name: string) =>
      (api[name] = async (p: { url: string; params: Record<string, unknown> }) =>
        name === 'nexoraGet' ? gets[p.url.slice(1)] : void posts.push({ path: p.url.slice(1), params: p.params })),
    getPinConversations: async () => ({ conversations: [], version: 1 }),
    getMute: async () => ({ chatEntries: [], groupChatEntries: [] }),
    getAutoDeleteChat: async () => ({ convers: [] }),
    removeUnreadMark: mock(async () => ({})),
    updateArchivedChatList: mock(async () => ({ needResync: false, version: 3 })),
    updateLabels: mock(async () => ({ version: 4 })),
    updateHiddenConversPin: mock(async () => ''),
    setHiddenConversations: mock(async () => ''),
    resetHiddenConversPin: mock(async () => ''),
  }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  const conversations = new ConversationService(zca, new ConversationRepository(db))
  zca.emit('attached', 'me', api as never)
  await Bun.sleep(5)
  expect(conversations.settings('me')).toMatchObject({
    unread: ['1035497930452690352'],
    archived: ['5'],
    labels: [{ id: 1, text: 'Khách hàng', conversations: ['8'] }],
    hidden: ['6'],
    hasPin: true,
  })

  // a mark carries the last message's ids, own messages as fromUid "0"
  await conversations.setUnread('me', '7', false, true)
  expect(JSON.parse(posts[0].params.param as string).convsUser).toMatchObject([{ id: '7', cliMsgId: 'c9', fromUid: '0' }])
  zca.emit('control', 'me', { act_type: 'mark_unread', act: 'remove', content: '{"convsUser":["7"],"convsGroup":[]}' })
  expect(conversations.settings('me').unread).toEqual(['1035497930452690352'])

  await conversations.setArchived('me', '6', true, true)
  expect(api.updateArchivedChatList).toHaveBeenCalledWith(true, { id: '6', type: ThreadType.Group })

  // one label per conversation, groups kept as "g" + id; names are unique
  await conversations.setLabel('me', '6', true, 1)
  expect((api.updateLabels as ReturnType<typeof mock>).mock.calls[0][0]).toMatchObject({ version: 3, labelData: [{ conversations: ['g8', 'g6'] }] })
  await expect(conversations.createLabel('me', { text: 'khách hàng', color: '#000000' })).rejects.toThrow('Phân loại đã tồn tại')
  await conversations.createLabel('me', { text: 'Gia đình', color: '#15a85f' })
  expect(conversations.settings('me').labels.map((l) => [l.id, l.text])).toEqual([[1, 'Khách hàng'], [2, 'Gia đình']])

  // PIN 1234 is set already: hiding needs it; another device's changes apply
  await expect(conversations.setHidden('me', '7', false, true, '0000')).rejects.toThrow('Mã PIN không đúng')
  await conversations.setHidden('me', '7', false, true, '1234')
  expect(conversations.pinMatches('me', '1234')).toBe(true)
  zca.emit('control', 'me', { act_type: 'hidden_chat', act: 'add_remove', data: { add_items: [], del_items: [{ thread_id: '6', is_group: 0 }] } })
  expect(conversations.settings('me').hidden).toEqual(['7'])
  expect(await conversations.resetPin('me')).toEqual(['7'])
  expect(conversations.settings('me')).toMatchObject({ hidden: [], hasPin: false })
  // the first hide after a reset sets the PIN
  await conversations.setHidden('me', '7', false, true, '4321')
  expect(api.updateHiddenConversPin).toHaveBeenCalledWith('4321')
  expect(conversations.pinMatches('me', '4321')).toBe(true)
})
