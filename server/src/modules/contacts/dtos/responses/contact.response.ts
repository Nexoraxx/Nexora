import type { GroupSetting } from '@hwqnq/zca-js'
import type { Profile } from '../../../accounts/dtos/responses/account.response'

export type Friend = { userId: string; displayName: string; zaloName: string; alias: string | null; avatar: string; phoneNumber: string; status: string | null; isBlocked: number | null }
export type FriendRequest = { userId: string; displayName: string; zaloName: string; avatar: string; friendRequestType: number; friendRequestMsg: string | null; friendRequestFetchTime: number | null; friendRequestRead: number | null }
export type Group = { userId: string; displayName: string; avatar: string; totalMember: number }
// Zalo PC's group members screen: owner ("Trưởng nhóm") first, then deputies ("Phó nhóm"), then the rest by name.
// canEdit follows setting.blockName ("Thay đổi tên & ảnh đại diện của nhóm" for admins only).
// locked: setting.lockViewMember and this account isn't owner/deputy, so members holds only owner, deputies and self.
export type GroupMember = { userId: string; name: string; avatar: string; role: 'owner' | 'admin' | null; isFr: boolean }
// setting: the group's switches (PC "Quản lý nhóm"); pending: join requests waiting, known to owner and deputies only
export type GroupDetails = {
  groupId: string
  name: string
  avatar: string
  desc: string
  totalMember: number
  canEdit: boolean
  locked: boolean
  setting: Partial<GroupSetting>
  pending: number
  members: GroupMember[]
}
export type BlockedUser = { userId: string; name: string; avatar: string }
// Zalo PC "Thông tin tài khoản" of someone else. Phone only for friends; request = pending friend request either way.
export type UserProfile = Omit<Profile, 'dob'> & {
  alias: string | null
  isFr: boolean
  isBlocked: boolean
  request: 'received' | 'sent' | null
  mutualGroups: { groupId: string; name: string; avatar: string }[]
}
