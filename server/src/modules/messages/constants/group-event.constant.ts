import { GroupEventType } from '@hwqnq/zca-js'

// Zalo PC's local system message for group events (MSG_GROUP_NOTI, -6 inside PC); not a Zalo msgType
export const GROUP_NOTI = 'group.noti'

// Events that change group state and that PC writes a system message for; board/topic/remind events carry no
// message (PC skips them) and join requests only matter to the approval screen.
export const GROUP_STATE_EVENTS = new Set<GroupEventType>([
  GroupEventType.JOIN,
  GroupEventType.LEAVE,
  GroupEventType.REMOVE_MEMBER,
  GroupEventType.BLOCK_MEMBER,
  GroupEventType.UPDATE,
  GroupEventType.UPDATE_AVATAR,
  GroupEventType.UPDATE_SETTING,
  GroupEventType.ADD_ADMIN,
  GroupEventType.REMOVE_ADMIN,
  GroupEventType.NEW_LINK,
])

export const YOU = 'Bạn'
export const LOCK_VIEW = 'chỉ cho phép trưởng/phó nhóm xem đầy đủ danh sách thành viên.'
export const UNLOCK_VIEW = 'cho phép mọi người xem danh sách thành viên.'
