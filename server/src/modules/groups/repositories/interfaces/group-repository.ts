export default interface IGroupRepository {
  groupNames(accountId: string): { userId: string; displayName: string }[]
  hasGroup(accountId: string, groupId: string): boolean
  setting(accountId: string, groupId: string): { setting: string | null } | null
  userNames(accountId: string, userIds: string[], prefer: 'alias' | 'zaloName'): { userId: string; name: string | null }[]
}
