import type { ReportReason, SentFriendRequestInfo } from '@hwqnq/zca-js'
import type { FindUserRequest } from '../../dtos/requests/contact.request'
import type { BlockedUser, Friend, FriendRequest, Group, GroupDetails, UserProfile } from '../../dtos/responses/contact.response'

export default interface IContactService {
  friends(accountId: string): Friend[]
  requests(accountId: string): FriendRequest[]
  groups(accountId: string): Group[]
  profile(accountId: string, userId: string): Promise<UserProfile>
  lastOnline(accountId: string, userId: string): Promise<number | null>
  onlineFriends(accountId: string): Promise<string[]>
  group(accountId: string, groupId: string): Promise<GroupDetails>
  refreshGroup(accountId: string, groupId: string): Promise<void>
  forgetGroup(accountId: string, groupId: string): void
  renameGroup(accountId: string, groupId: string, name: string): Promise<void>
  sentRequests(accountId: string): Promise<SentFriendRequestInfo[]>
  findUser(accountId: string, body: FindUserRequest): Promise<{ userId: string; displayName: string; zaloName: string; avatar: string; isFr: number } | null>
  sync(accountId: string): Promise<void>
  cloud(accountId: string): { threadId: string | null; name: string }
  ensureKnown(accountId: string, userIds: string[], groupIds: string[]): Promise<boolean>
  accept(accountId: string, userId: string): Promise<void>
  reject(accountId: string, userId: string): Promise<void>
  seenRequests(accountId: string): Promise<void>
  sendRequest(accountId: string, userId: string, message: string): Promise<void>
  undoRequest(accountId: string, userId: string): Promise<void>
  removeFriend(accountId: string, userId: string): Promise<void>
  setAlias(accountId: string, userId: string, alias: string): Promise<void>
  blockList(accountId: string): Promise<BlockedUser[]>
  report(accountId: string, targetId: string, isGroup: boolean, reason: ReportReason, content: string): Promise<void>
  setBlocked(accountId: string, userId: string, blocked: boolean): Promise<void>
}
