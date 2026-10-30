import { expect, test } from 'bun:test'
import { GroupEventType, type GroupEvent } from '@hwqnq/zca-js'
import { groupEventText } from './services/implements/group-event'

const NAMES: Record<string, string> = { a: 'An', b: 'Bình', c: 'Chi', d: 'Dũng' }
const ctx = { me: 'me', name: (id: string) => NAMES[id], setting: { joinAppr: 0, lockViewMember: 0 }, creatorId: 'o' }
const ev = (type: GroupEventType, sourceId: string, members: string[], extra: Record<string, unknown> = {}) =>
  ({ type, act: type, threadId: 'g', isSelf: false, data: { groupId: 'g', sourceId, creatorId: 'o', updateMembers: members.map((id) => ({ id, dName: `z${id}` })), ...extra } }) as unknown as GroupEvent

test('group events read like Zalo PC system messages', () => {
  const text = (e: GroupEvent) => groupEventText(e, ctx)
  expect(text(ev(GroupEventType.JOIN, 'a', ['b', 'me']))).toBe('Bạn, Bình được An thêm vào nhóm')
  expect(text(ev(GroupEventType.JOIN, 'me', ['x']))).toBe('zx được bạn thêm vào nhóm')
  expect(text(ev(GroupEventType.JOIN, 'a', ['a']))).toBe('An đã tham gia nhóm')
  expect(text(ev(GroupEventType.JOIN, 'me', ['me']))).toBe('Bạn vừa tham gia nhóm')
  expect(text(ev(GroupEventType.JOIN, 'o', ['o']))).toBe('')
  expect(text(ev(GroupEventType.LEAVE, 'a', ['a']))).toBe('An đã rời khỏi nhóm')
  expect(text(ev(GroupEventType.REMOVE_MEMBER, 'a', ['b', 'c']))).toBe('Bình, Chi được An xóa khỏi nhóm')
  expect(text(ev(GroupEventType.BLOCK_MEMBER, 'me', ['b']))).toBe('Bình bị bạn chặn khỏi nhóm này')
  expect(text(ev(GroupEventType.UPDATE, 'a', [], { groupName: 'Lớp 12' }))).toBe('An đổi tên nhóm thành "Lớp 12"')
  expect(text(ev(GroupEventType.UPDATE, 'me', [], { groupName: 'Lớp 12' }))).toBe('Tên nhóm đã đổi thành "Lớp 12"')
  expect(text(ev(GroupEventType.UPDATE_AVATAR, 'a', []))).toBe('An đổi ảnh đại diện nhóm')
  expect(text(ev(GroupEventType.ADD_ADMIN, 'o', ['me']))).toBe('Bạn đã trở thành phó nhóm')
  expect(text(ev(GroupEventType.ADD_ADMIN, 'o', ['a', 'me', 'b', 'c', 'd']))).toBe('Bạn, An và 3 người khác đã được bổ nhiệm thành phó nhóm')
  expect(text(ev(GroupEventType.ADD_ADMIN, 'o', ['a'], { creatorId: 'a' }))).toBe('')
  expect(text(ev(GroupEventType.REMOVE_ADMIN, 'o', ['b']))).toBe('Bình đã không còn là phó nhóm')
  expect(text(ev(GroupEventType.UPDATE_SETTING, 'a', [], { groupSetting: { joinAppr: 1, lockViewMember: 0 } }))).toBe(
    'Hình thức tham gia nhóm được thay đổi thành "Cần phê duyệt".',
  )
  expect(text(ev(GroupEventType.UPDATE_SETTING, 'a', [], { groupSetting: { joinAppr: 0, lockViewMember: 1 } }))).toBe(
    'An chỉ cho phép trưởng/phó nhóm xem đầy đủ danh sách thành viên.',
  )
  expect(text(ev(GroupEventType.UPDATE_SETTING, 'a', [], { groupSetting: { joinAppr: 0, lockViewMember: 0, blockName: 1 } }))).toBe('')
  expect(text(ev(GroupEventType.JOIN, 'a', ['b'], { hideGroupInfo: 1 }))).toBe('')
  expect(text(ev(GroupEventType.NEW_PIN_TOPIC, 'a', []))).toBe('')
})
