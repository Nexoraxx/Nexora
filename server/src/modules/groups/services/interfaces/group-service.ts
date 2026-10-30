import type { ChangeAvatarRequest } from '../../../accounts/dtos/requests/account.request'
import type { CreateGroupRequest, GroupSettingsRequest, LeaveGroupRequest } from '../../dtos/requests/group.request'
import type { BlockedMember, GroupInvitation, GroupLink, LinkGroup, PendingMember } from '../../dtos/responses/group.response'

export default interface IGroupService {
  create(accountId: string, body: CreateGroupRequest): Promise<{ groupId: string; name: string }>
  addMembers(accountId: string, groupId: string, userIds: string[]): Promise<{ errors: string[] }>
  inviteToGroups(accountId: string, userId: string, groupIds: string[]): Promise<{ errors: string[] }>
  removeMember(accountId: string, groupId: string, userId: string): Promise<void>
  leave(accountId: string, groupId: string, body: LeaveGroupRequest): Promise<void>
  disperse(accountId: string, groupId: string): Promise<void>
  changeOwner(accountId: string, groupId: string, userId: string): Promise<void>
  setDeputy(accountId: string, groupId: string, userId: string, deputy: boolean): Promise<void>
  setBlocked(accountId: string, groupId: string, userId: string, blocked: boolean): Promise<void>
  blocked(accountId: string, groupId: string): Promise<BlockedMember[]>
  pending(accountId: string, groupId: string): Promise<PendingMember[]>
  review(accountId: string, groupId: string, userIds: string[], approve: boolean): Promise<{ errors: string[] }>
  link(accountId: string, groupId: string): Promise<GroupLink>
  renewLink(accountId: string, groupId: string): Promise<GroupLink>
  disableLink(accountId: string, groupId: string): Promise<void>
  linkInfo(accountId: string, link: string): Promise<LinkGroup>
  joinLink(accountId: string, link: string): Promise<{ groupId: string }>
  invitations(accountId: string): Promise<GroupInvitation[]>
  joinInvitation(accountId: string, groupId: string): Promise<void>
  declineInvitation(accountId: string, groupId: string, block: boolean): Promise<void>
  changeAvatar(accountId: string, groupId: string, body: ChangeAvatarRequest): Promise<void>
  updateSettings(accountId: string, groupId: string, change: GroupSettingsRequest): Promise<void>
}
