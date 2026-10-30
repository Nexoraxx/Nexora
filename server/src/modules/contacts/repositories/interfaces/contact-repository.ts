import type { GetAllFriendsResponse, GetFriendRecommendationsResponse, GroupInfoResponse } from '@hwqnq/zca-js'
import type { Profile } from '../../../accounts/dtos/responses/account.response'
import type { Friend, FriendRequest, Group, UserProfile } from '../../dtos/responses/contact.response'

export type GroupInfo = GroupInfoResponse['gridInfoMap'][string]
export type ProfileRow = Omit<Profile, 'dob'> & { alias: string | null; isFr: number; isBlocked: number | null; friendRequestType: number | null }
export type BlockedProfile = { userId: string; displayName?: string; zaloName?: string; avatar?: string }

export default interface IContactRepository {
  friends(accountId: string): Friend[]
  requests(accountId: string): FriendRequest[]
  groups(accountId: string): Group[]
  profile(accountId: string, userId: string): ProfileRow | null
  mutualGroups(accountId: string, groupIds: string[]): UserProfile['mutualGroups']
  friendType(accountId: string, userId: string): { isFr: number; type: number | null } | null
  friendFlag(accountId: string, userId: string): { isFr: number } | null
  members(accountId: string, userIds: string[]): { userId: string; name: string; avatar: string | null; isFr: number }[]
  deleteGroup(accountId: string, groupId: string): void
  renameGroup(accountId: string, groupId: string, name: string): void
  groupVersions(accountId: string): { userId: string; version: string | null }[]
  // Full replace of friends, aliases, friend requests and the joined groups, in one transaction
  sync(
    accountId: string,
    friends: GetAllFriendsResponse,
    aliases: { userId: string; alias: string }[],
    recomm: GetFriendRecommendationsResponse,
    gridVerMap: Record<string, string>,
    infos: GroupInfo[],
  ): void
  nameless(accountId: string): { userId: string }[]
  // A row without a name isn't known: an alias or friend event alone creates one
  isKnown(table: 'user' | 'groups', accountId: string, id: string): boolean
  saveGroups(accountId: string, infos: GroupInfo[], versions?: Record<string, string>): void
  unseenRequests(accountId: string, friendRequestType: number): { userId: string }[]
  blocked(accountId: string): { userId: string }[]
  // The whole block list: anyone not in it is unblocked
  replaceBlocked(accountId: string, profiles: BlockedProfile[]): void
  names(accountId: string, userIds: string[]): { userId: string; name: string | null }[]
  upsertUsers(rows: Record<string, unknown>[]): void
  set(accountId: string, userId: string, fields: Record<string, unknown>): void
}
