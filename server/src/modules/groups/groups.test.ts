import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { ZaloApiError } from '@hwqnq/zca-js'
import { openDatabase, upsert } from '../../dbs/sqlite'
import type { ZcaService } from '../../third-party/zalo/zalo-client'
import type IContactService from '../contacts/services/interfaces/contact-service'
import type IMessageService from '../messages/services/interfaces/message-service'
import GroupRepository from './repositories/implements/group-repository'
import GroupService from './services/implements/group-service'
import { inviteError } from './helpers/group.helper'

test('create, settings, invite errors and leaving follow Zalo PC', async () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  upsert(db, 'user', [
    { accountId: 'me', userId: 'a', displayName: 'An', zaloName: '' },
    { accountId: 'me', userId: 'b', displayName: 'Bình', zaloName: 'Bình Zalo' },
  ])
  upsert(db, 'groups', [{ accountId: 'me', userId: 'g1', displayName: 'G' }])
  upsert(db, 'group_info', [{ accountId: 'me', userId: 'g1', setting: { blockName: 1, joinAppr: 0, lockViewMember: 1, addMemberOnly: 0 } }])

  const nexoraGet = mock(async (p: { url: string; params: Record<string, unknown> }) => (p.url.endsWith('/create/v2') ? { groupId: 'g2' } : ''))
  const leaveGroup = mock(async () => ({ memberError: [] }))
  const api = {
    zpwServiceMap: { group: ['https://group'] },
    getContext: () => ({ imei: 'imei', language: 'vi' }),
    nexoraGet,
    leaveGroup,
    addUserToGroup: async () => ({ errorMembers: ['a', 'b'], error_data: { '178': ['a'], '263': ['b'] } }),
    disperseGroup: async () => {
      throw new ZaloApiError('no', 166)
    },
  }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  const refreshGroup = mock(async (_accountId: string, _groupId: string) => {})
  const leftGroup = mock(() => {})
  const groups = new GroupService(new GroupRepository(db), zca, { refreshGroup } as unknown as IContactService, { leftGroup } as unknown as IMessageService)

  // unnamed: the members' Zalo names (display name when empty), nameChanged 0, PC's memberTypes and groupType
  expect(await groups.create('me', { name: '', members: ['a', 'b'] })).toEqual({ groupId: 'g2', name: 'An, Bình Zalo' })
  expect(nexoraGet.mock.calls[0][0]).toMatchObject({
    url: 'https://group/api/group/create/v2',
    params: { gname: 'An, Bình Zalo', members: ['a', 'b'], memberTypes: [-1, -1], nameChanged: 0, createLink: 1, groupType: 1, imei: 'imei', clientLang: 'vi' },
  })
  await groups.create('me', { name: ' Nhóm #1! ', members: ['a', 'b'] })
  expect(nexoraGet.mock.calls[1][0].params).toMatchObject({ gname: 'Nhóm 1', nameChanged: 1 })
  expect(refreshGroup.mock.calls[0]).toEqual(['me', 'g2'])

  // the whole stored setting goes out with the change
  await groups.updateSettings('me', 'g1', { joinAppr: 1 })
  expect(nexoraGet.mock.calls[2][0]).toMatchObject({
    url: 'https://group/api/group/setting/update',
    params: { blockName: 1, joinAppr: 1, lockViewMember: 1, addMemberOnly: 0, blocked_members: [], grid: 'g1', imei: 'imei' },
  })

  expect(await groups.addMembers('me', 'g1', ['a', 'b'])).toEqual({
    errors: ['An đã là thành viên của nhóm từ trước', 'Bình đã được bạn mời vào nhóm và cần xác nhận tham gia'],
  })
  expect(inviteError(178, ['A', 'B', 'C'])).toBe('A và 2 người khác đã là thành viên của nhóm từ trước')
  expect(inviteError(175, ['A'])).toBe('')

  // PC's error text for a known code; the group stays
  await expect(groups.disperse('me', 'g1')).rejects.toThrow('Chỉ có trưởng/phó nhóm thực hiện được tính năng này.')
  expect(leftGroup).not.toHaveBeenCalled()

  // leaving drops the group and its conversation
  await groups.leave('me', 'g1', { silent: true })
  expect(leaveGroup.mock.calls[0]).toEqual(['g1', true] as never)
  expect(leftGroup.mock.calls[0]).toEqual(['me', 'g1'] as never)
})

test('"Thêm vào nhóm" sends invite/multi as PC and names each group that refused', async () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  upsert(db, 'user', [{ accountId: 'me', userId: 'a', displayName: 'An', alias: 'An béo' }])
  upsert(db, 'groups', [
    { accountId: 'me', userId: 'g1', displayName: 'Nhóm Một' },
    { accountId: 'me', userId: 'g2', displayName: 'Nhóm Hai' },
    { accountId: 'me', userId: 'g3', displayName: 'Nhóm Ba' },
  ])
  const nexoraGet = mock(async () => ({ grid_error_map: { g1: 0, g2: 178, g3: 166 } }))
  const api = { zpwServiceMap: { group: ['https://group'] }, getContext: () => ({ imei: 'imei', language: 'vi' }), nexoraGet }
  const zca = Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService
  const groups = new GroupService(new GroupRepository(db), zca, {} as IContactService, {} as IMessageService)

  expect(await groups.inviteToGroups('me', 'a', ['g1', 'g2', 'g3'])).toEqual({ errors: ['Nhóm Ba: Bạn không đủ quyền để thêm An béo vào nhóm'] })
  expect(nexoraGet.mock.calls[0]).toEqual([
    { url: 'https://group/api/group/invite/multi', params: { grids: ['g1', 'g2', 'g3'], member: 'a', memberType: -1, srcInteraction: 0, clientLang: 'vi' } },
  ] as never)
})
