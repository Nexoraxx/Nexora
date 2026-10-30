import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { FriendEventType } from '@hwqnq/zca-js'
import { openDatabase } from '../../dbs/sqlite'
import type { ZcaService } from '../../third-party/zalo/zalo-client'
import SettingsService from '../settings/services/implements/settings-service'
import ContactRepository from './repositories/implements/contact-repository'
import ContactService from './services/implements/contact-service'

const user = (userId: string, displayName = userId) => ({ userId, displayName, zaloName: displayName, avatar: '', isFr: 1 })
const group = (groupId: string) => ({ groupId, name: groupId, avt: '', totalMember: 3, memberIds: ['a', 'b'], adminIds: [], setting: {} })

test('sync mirrors Zalo state; groups refetch only on version change; friend events and actions update rows', async () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)

  let friends = [user('a', 'An'), user('b', 'Bình')]
  let gridVerMap: Record<string, string> = { g1: '1', g2: '1' }
  const getGroupInfo = mock(async (ids: string[]) => ({ gridInfoMap: Object.fromEntries(ids.map((id) => [id, group(id)])) }))
  const api = {
    getAllFriends: async () => friends,
    // 'x' isn't a friend: Zalo's alias list also holds strangers
    getAliasList: async () => ({ items: [{ userId: 'a', alias: 'An béo' }, { userId: 'x', alias: 'Người lạ' }], updateTime: '' }),
    getFriendRecommendations: async () => ({
      recommItems: [{ recommItemType: 1, dataInfo: { userId: 'c', displayName: 'Chi', recommType: 2, recommTime: 5, recommInfo: { message: 'kb nhé', source: 1 }, isSeenFriendReq: false } }],
    }),
    getAllGroups: async () => ({ version: '1', gridVerMap }),
    getGroupInfo,
    getUserInfo: async (ids: string[]) => ({ changed_profiles: Object.fromEntries(ids.map((id) => [`${id}_0`, { ...user(id), isFr: 0 }])) }),
    acceptFriendRequest: async () => '',
    getContext: () => ({ loginInfo: { send2me_id: 'cloud' } }),
  }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  const contacts = new ContactService(new ContactRepository(db), zca, new SettingsService(zca))
  const ids = (rows: { userId: string }[]) => rows.map((r) => r.userId).sort()

  await contacts.sync('me')
  expect(ids(contacts.friends('me'))).toEqual(['a', 'b'])
  expect(contacts.friends('me').find((f) => f.userId === 'a')?.alias).toBe('An béo')
  expect(contacts.requests('me')).toMatchObject([{ userId: 'c', friendRequestType: 2, friendRequestMsg: 'kb nhé', friendRequestRead: 0 }])
  expect(ids(contacts.groups('me'))).toEqual(['g1', 'g2'])
  // an alias alone isn't a known user: its name is fetched, so removing the alias doesn't leave it blank
  expect(db.query(`SELECT displayName FROM user WHERE userId = 'x'`).get()).toEqual({ displayName: 'x' })
  // "Cloud của tôi" gets its name; it isn't a friend
  expect(db.query(`SELECT displayName, isFr FROM user WHERE userId = 'cloud'`).get()).toEqual({ displayName: 'Cloud của tôi', isFr: 0 })

  friends = [user('a', 'An')]
  gridVerMap = { g1: '1', g3: '1' }
  getGroupInfo.mockClear()
  await contacts.sync('me')
  expect(ids(contacts.friends('me'))).toEqual(['a'])
  expect(getGroupInfo.mock.calls).toEqual([[['g3']]])
  expect(ids(contacts.groups('me'))).toEqual(['g1', 'g3'])
  expect(db.query(`SELECT count(*) AS n FROM group_info WHERE userId = 'g2'`).get()).toEqual({ n: 0 })

  zca.emit('friend_event', 'me', { type: FriendEventType.REQUEST, data: { fromUid: 'd', toUid: 'me', src: 30, message: 'hi' }, threadId: 'me', isSelf: false })
  await Bun.sleep(0)
  expect(ids(contacts.requests('me'))).toEqual(['c', 'd'])

  zca.emit('friend_event', 'me', { type: FriendEventType.BLOCK, data: 'a', threadId: 'a', isSelf: true })
  await Bun.sleep(0)
  expect(contacts.friends('me').find((f) => f.userId === 'a')?.isBlocked).toBe(1)

  await contacts.accept('me', 'c')
  expect(ids(contacts.friends('me'))).toEqual(['a', 'c'])
  expect(ids(contacts.requests('me'))).toEqual(['d'])
})

test('profile of someone else: fresh fetch, phone only for friends, mutual groups by name, pending request', async () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  db.run(`INSERT INTO groups (accountId, userId, displayName, avatar) VALUES ('me', 'g1', 'Nhóm Một', ''), ('me', 'g2', 'Nhóm Hai', '')`)
  const profiles: Record<string, Record<string, unknown>> = {
    a: { userId: 'a', displayName: 'An', zaloName: 'An', avatar: '', phoneNumber: '84901', isFr: 1, gender: 1, sdob: '01/02/2000' },
    s: { userId: 's', displayName: 'Sơn', zaloName: 'Sơn', avatar: '', phoneNumber: '84902', isFr: 0 },
  }
  const api = {
    getUserInfo: async (ids: string[]) => ({ changed_profiles: Object.fromEntries(ids.map((id) => [`${id}_0`, profiles[id]])) }),
    getProfileExtra: async () => ({ groupIds: ['g2', 'g1', 'gone'] }),
    getSentFriendRequest: async () => ({ s: { userId: 's' } }),
  }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  const contacts = new ContactService(new ContactRepository(db), zca, new SettingsService(zca))

  expect(await contacts.profile('me', 'a')).toMatchObject({
    displayName: 'An',
    phoneNumber: '84901',
    gender: 1,
    sdob: '01/02/2000',
    isFr: true,
    request: null,
    mutualGroups: [{ groupId: 'g2', name: 'Nhóm Hai' }, { groupId: 'g1', name: 'Nhóm Một' }],
  })
  expect(await contacts.profile('me', 's')).toMatchObject({ phoneNumber: null, isFr: false, request: 'sent' })
})

test('group details: owner, deputies, then members by name; only unknown members are fetched', async () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  db.run(`INSERT INTO user (accountId, userId, displayName, alias, isFr) VALUES ('me', 'b', 'Bình', 'Bình béo', 1), ('me', 'me', 'Tôi', NULL, 0)`)
  const getGroupMembersInfo = mock(async (ids: string[]) => ({ profiles: Object.fromEntries(ids.map((id) => [id, { id, displayName: id.toUpperCase(), zaloName: id, avatar: '' }])) }))
  const api = {
    getGroupInfo: async () => ({
      gridInfoMap: { g1: { groupId: 'g1', name: 'Nhóm', avt: '', desc: '', totalMember: 4, creatorId: 'z', adminIds: ['c'], memVerList: ['me_1', 'b_2', 'c_3', 'z_4'], memberIds: [], setting: { blockName: 1 } } },
    }),
    getGroupMembersInfo,
  }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  const contacts = new ContactService(new ContactRepository(db), zca, new SettingsService(zca))

  const g = await contacts.group('me', 'g1')
  expect(getGroupMembersInfo.mock.calls).toEqual([[['c', 'z']]])
  expect(g.members.map((m) => [m.name, m.role])).toEqual([
    ['Z', 'owner'],
    ['C', 'admin'],
    ['Bình béo', null],
    ['Tôi', null],
  ])
  expect(g.canEdit).toBe(false)
  expect(contacts.groups('me')).toMatchObject([{ userId: 'g1', displayName: 'Nhóm' }])
})

test('locked member list (lockViewMember, not owner/deputy): only owner, deputies and self, nobody else fetched', async () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  const getGroupMembersInfo = mock(async (ids: string[]) => ({ profiles: Object.fromEntries(ids.map((id) => [id, { id, displayName: id.toUpperCase(), zaloName: id, avatar: '' }])) }))
  let adminIds = ['c']
  const api = {
    getGroupInfo: async () => ({
      gridInfoMap: { g1: { groupId: 'g1', name: 'Nhóm', avt: '', totalMember: 5, creatorId: 'z', adminIds, memVerList: ['me_1', 'b_2', 'c_3', 'z_4', 'x_5'], memberIds: [], setting: { lockViewMember: 1 } } },
    }),
    getGroupMembersInfo,
  }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  const contacts = new ContactService(new ContactRepository(db), zca, new SettingsService(zca))

  const g = await contacts.group('me', 'g1')
  expect(g.locked).toBe(true)
  expect(g.totalMember).toBe(5)
  expect(g.members.map((m) => m.userId)).toEqual(['z', 'c', 'me'])
  expect(getGroupMembersInfo.mock.calls.flat(2).sort()).toEqual(['c', 'me', 'z'])

  adminIds = ['me']
  expect((await contacts.group('me', 'g1')).members).toHaveLength(5)
})

test('block list: every page, PC names, local flags corrected; report goes out as PC sends it', async () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  // 'old' was unblocked on the phone while offline; 'a' has an alias
  db.run(`INSERT INTO user (accountId, userId, displayName, alias, isFr, isBlocked) VALUES ('me', 'a', 'An', 'An béo', 1, 0), ('me', 'old', 'Cũ', NULL, 1, 1)`)
  const getBlockList = mock(async (page: number) =>
    page === 1
      ? { profiles: [{ userId: 'a', displayName: 'An', zaloName: 'an', avatar: 'x' }], has_more: true }
      : { profiles: [{ userId: 's', displayName: '', zaloName: 'Sơn', avatar: '' }], has_more: false },
  )
  const sendReport = mock(async () => ({ reportId: '1' }))
  const zca = Object.assign(new EventEmitter(), { get: () => ({ getBlockList, sendReport }) }) as unknown as ZcaService
  const contacts = new ContactService(new ContactRepository(db), zca, new SettingsService(zca))

  expect(await contacts.blockList('me')).toEqual([
    { userId: 'a', name: 'An béo', avatar: 'x' },
    { userId: 's', name: 'Sơn', avatar: '' },
  ])
  expect(getBlockList.mock.calls.map((c) => c[0])).toEqual([1, 2])
  expect(db.query(`SELECT userId FROM user WHERE isBlocked = 1 ORDER BY userId`).all()).toEqual([{ userId: 'a' }, { userId: 's' }])

  await contacts.report('me', 'a', false, 2, 'ignored')
  await contacts.report('me', 'g1', true, 0, 'spam')
  expect(sendReport.mock.calls as unknown[]).toEqual([
    [{ reason: 2 }, 'a', 0],
    [{ reason: 0, content: 'spam' }, 'g1', 1],
  ])
})

test('last online: friends only, both sides showing their status; online friends cached 60 s, none while hidden', async () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  db.run(`INSERT INTO user (accountId, userId, displayName, isFr) VALUES ('me', 'a', 'An', 1), ('me', 'b', 'Bình', 1), ('me', 's', 'Sơn', 0)`)
  let mine = true
  const lastOnline = mock(async (uid: string) => ({ settings: { show_online_status: uid === 'a' }, lastOnline: 1000 }))
  const nexoraGet = mock(async () => ({ onlines: [{ userId: 'a', status: '' }] }))
  const api = { zpwServiceMap: { profile: ['https://profile'] }, getContext: () => ({ imei: 'imei' }), getSettings: async () => ({ show_online_status: mine }), lastOnline, nexoraGet }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  const contacts = new ContactService(new ContactRepository(db), zca, new SettingsService(zca))

  expect(await contacts.lastOnline('me', 'a')).toBe(1000)
  // 'b' hides it; 's' isn't a friend, so isn't asked
  expect(await contacts.lastOnline('me', 'b')).toBeNull()
  expect(await contacts.lastOnline('me', 's')).toBeNull()
  expect(lastOnline.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])

  expect(await contacts.onlineFriends('me')).toEqual(['a'])
  expect(await contacts.onlineFriends('me')).toEqual(['a'])
  expect(nexoraGet.mock.calls).toHaveLength(1)
  expect(nexoraGet.mock.calls[0]).toEqual([{ url: 'https://profile/api/social/friend/onlines', params: { imei: 'imei' } }] as never)

  mine = false
  const hidden = new ContactService(new ContactRepository(db), zca, new SettingsService(zca))
  expect(await hidden.onlineFriends('me')).toEqual([])
  expect(await hidden.lastOnline('me', 'a')).toBeNull()
})

test('seen friend requests: unseen received ones only; Zalo told only when contactTabV2.seen_friendrequest is on', async () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  db.run(`INSERT INTO user (accountId, userId, displayName, friendRequestType, friendRequestRead) VALUES
    ('me', 'a', 'An', 2, 0), ('me', 'b', 'Bình', 2, 1), ('me', 'c', 'Chi', 1, 0), ('me', 'd', 'Dũng', 2, NULL)`)
  let seen_friendrequest = 0
  const seenFriendRequests = mock(async () => '')
  const api = { getContext: () => ({ settings: { features: { contactTabV2: { seen_friendrequest } } } }), seenFriendRequests }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  const contacts = new ContactService(new ContactRepository(db), zca, new SettingsService(zca))
  const unseen = () => contacts.requests('me').filter((r) => r.friendRequestType === 2 && !r.friendRequestRead).map((r) => r.userId)

  await contacts.seenRequests('me')
  expect(seenFriendRequests).not.toHaveBeenCalled()
  expect(unseen()).toEqual([])

  db.run(`UPDATE user SET friendRequestRead = 0 WHERE userId IN ('a', 'd')`)
  seen_friendrequest = 1
  await contacts.seenRequests('me')
  expect((seenFriendRequests.mock.calls[0] as unknown[])[0]).toEqual(['a', 'd'])
  await contacts.seenRequests('me')
  expect(seenFriendRequests).toHaveBeenCalledTimes(1)
})

test('find user: by phone or by username, marked when already a friend', async () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  db.run(`INSERT INTO user (accountId, userId, displayName, isFr) VALUES ('me', 'a', 'An', 1)`)
  const found = (uid: string) => async () => ({ uid, display_name: uid.toUpperCase(), zalo_name: uid, avatar: '' })
  const api = { findUser: mock(found('a')), findUserByUsername: mock(found('b')) }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  const contacts = new ContactService(new ContactRepository(db), zca, new SettingsService(zca))

  expect(await contacts.findUser('me', { phone: '0901' })).toMatchObject({ userId: 'a', isFr: 1 })
  expect(await contacts.findUser('me', { username: 'binh.nguyen' })).toMatchObject({ userId: 'b', displayName: 'B', isFr: 0 })
  expect(api.findUser.mock.calls as unknown[]).toEqual([['0901']])
  expect(api.findUserByUsername.mock.calls as unknown[]).toEqual([['binh.nguyen']])
})
