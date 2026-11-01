import { inject, injectable } from 'inversify'
import type { GetAllFriendsResponse, GetFriendRecommendationsResponse } from '@hwqnq/zca-js'
import { Database, upsert } from '../../../../dbs/sqlite'
import { TOKENS } from '../../../../di/tokens'
import type { Friend, FriendRequest, Group, UserProfile } from '../../dtos/responses/contact.response'
import type IContactRepository from '../interfaces/contact-repository'
import type { BlockedProfile, GroupInfo, ProfileRow } from '../../models/contact.model'

@injectable()
export default class ContactRepository implements IContactRepository {
  constructor(@inject(TOKENS.Database) private db: Database) {}

  friends(accountId: string) {
    return this.db
      .query<Friend, [string]>(`SELECT userId, displayName, zaloName, alias, avatar, phoneNumber, status, isBlocked FROM user WHERE accountId = ? AND isFr = 1`)
      .all(accountId)
  }

  requests(accountId: string) {
    return this.db
      .query<FriendRequest, [string]>(
        `SELECT userId, displayName, zaloName, avatar, friendRequestType, friendRequestMsg, friendRequestFetchTime, friendRequestRead
         FROM user WHERE accountId = ? AND friendRequestType IS NOT NULL ORDER BY friendRequestType DESC, friendRequestFetchTime DESC`,
      )
      .all(accountId)
  }

  groups(accountId: string) {
    return this.db.query<Group, [string]>(`SELECT userId, displayName, avatar, totalMember FROM groups WHERE accountId = ?`).all(accountId)
  }

  profile(accountId: string, userId: string) {
    return this.db
      .query<ProfileRow, [string, string]>(
        `SELECT userId, displayName, zaloName, alias, avatar, cover, status, gender, sdob, phoneNumber, isFr, isBlocked, friendRequestType
         FROM user WHERE accountId = ? AND userId = ?`,
      )
      .get(accountId, userId)
  }

  mutualGroups(accountId: string, groupIds: string[]) {
    return this.db
      .query<UserProfile['mutualGroups'][number], [string, string]>(
        `SELECT userId AS groupId, displayName AS name, avatar FROM groups WHERE accountId = ? AND userId IN (SELECT value FROM json_each(?)) ORDER BY displayName`,
      )
      .all(accountId, JSON.stringify(groupIds))
  }

  friendType(accountId: string, userId: string) {
    return this.db.query<{ isFr: number; type: number | null }, [string, string]>(`SELECT isFr, type FROM user WHERE accountId = ? AND userId = ?`).get(accountId, userId)
  }

  friendFlag(accountId: string, userId: string) {
    return this.db.query<{ isFr: number }, [string, string]>(`SELECT isFr FROM user WHERE accountId = ? AND userId = ?`).get(accountId, userId)
  }

  members(accountId: string, userIds: string[]) {
    return this.db
      .query<{ userId: string; name: string; avatar: string | null; isFr: number }, [string, string]>(
        `SELECT userId, COALESCE(alias, displayName) AS name, avatar, isFr FROM user WHERE accountId = ? AND userId IN (SELECT value FROM json_each(?))`,
      )
      .all(accountId, JSON.stringify(userIds))
  }

  deleteGroup(accountId: string, groupId: string) {
    for (const table of ['groups', 'group_info']) this.db.run(`DELETE FROM ${table} WHERE accountId = ? AND userId = ?`, [accountId, groupId])
  }

  renameGroup(accountId: string, groupId: string, name: string) {
    upsert(this.db, 'groups', [{ accountId, userId: groupId, displayName: name }])
  }

  groupVersions(accountId: string) {
    return this.db.query<{ userId: string; version: string | null }, [string]>(`SELECT userId, version FROM groups WHERE accountId = ?`).all(accountId)
  }

  sync(
    accountId: string,
    friends: GetAllFriendsResponse,
    aliases: { userId: string; alias: string }[],
    recomm: GetFriendRecommendationsResponse,
    gridVerMap: Record<string, string>,
    infos: GroupInfo[],
  ) {
    this.db.transaction(() => {
      this.db.run(`UPDATE user SET isFr = 0, alias = NULL, friendRequestType = NULL WHERE accountId = ?`, [accountId])
      upsert(this.db, 'user', friends.map((f) => ({ ...f, accountId, isFr: 1 })))
      upsert(this.db, 'user', aliases.map((a) => ({ accountId, userId: a.userId, alias: a.alias })))
      upsert(
        this.db,
        'user',
        recomm.recommItems.map(({ dataInfo: d }) => ({
          accountId,
          userId: d.userId,
          displayName: d.displayName,
          zaloName: d.zaloName,
          avatar: d.avatar,
          phoneNumber: d.phoneNumber,
          status: d.status,
          gender: d.gender,
          dob: d.dob,
          bizPkg: d.bizPkg,
          friendRequestType: d.recommType,
          friendRequestMsg: d.recommInfo?.message,
          friendRequestSource: d.recommInfo?.source,
          friendRequestFetchTime: d.recommTime,
          friendRequestRead: d.isSeenFriendReq,
        })),
      )

      const joined = JSON.stringify(Object.keys(gridVerMap))
      for (const table of ['groups', 'group_info'])
        this.db.run(`DELETE FROM ${table} WHERE accountId = ? AND userId NOT IN (SELECT value FROM json_each(?))`, [accountId, joined])
      this.saveGroups(accountId, infos, gridVerMap)
    })()
  }

  nameless(accountId: string) {
    return this.db.query<{ userId: string }, [string]>(`SELECT userId FROM user WHERE accountId = ? AND displayName IS NULL`).all(accountId)
  }

  isKnown(table: 'user' | 'groups', accountId: string, id: string) {
    return !!this.db.query(`SELECT 1 FROM ${table} WHERE accountId = ? AND userId = ? AND displayName IS NOT NULL`).get(accountId, id)
  }

  saveGroups(accountId: string, infos: GroupInfo[], versions: Record<string, string> = {}) {
    const now = Date.now()
    upsert(
      this.db,
      'groups',
      infos.map((g) => ({
        accountId,
        userId: g.groupId,
        displayName: g.name,
        avatar: g.avt,
        desc: g.desc,
        type: g.type,
        subType: g.subType,
        visibility: g.visibility,
        e2ee: g.e2ee,
        globalId: g.globalId,
        creatorId: g.creatorId,
        totalMember: g.totalMember,
        version: String(versions[g.groupId] ?? g.version),
        lastUpdate: now,
      })),
    )
    upsert(
      this.db,
      'group_info',
      infos.map((g) => ({
        accountId,
        userId: g.groupId,
        memberIds: g.memberIds,
        adminIds: g.adminIds,
        maxMember: g.maxMember,
        setting: g.setting,
        pendingApproveUsers: g.pendingApprove?.uids,
        lastUpdate: now,
      })),
    )
  }

  unseenRequests(accountId: string, friendRequestType: number) {
    return this.db
      .query<{ userId: string }, [string, number]>(`SELECT userId FROM user WHERE accountId = ? AND friendRequestType = ? AND NOT COALESCE(friendRequestRead, 0)`)
      .all(accountId, friendRequestType)
  }

  blocked(accountId: string) {
    return this.db.query<{ userId: string }, [string]>(`SELECT userId FROM user WHERE accountId = ? AND isBlocked = 1 ORDER BY userId`).all(accountId)
  }

  replaceBlocked(accountId: string, profiles: BlockedProfile[]) {
    const ids = JSON.stringify(profiles.map((p) => p.userId))
    this.db.transaction(() => {
      this.db.run(`UPDATE user SET isBlocked = 0 WHERE accountId = ? AND isBlocked = 1 AND userId NOT IN (SELECT value FROM json_each(?))`, [accountId, ids])
      upsert(this.db, 'user', profiles.map((p) => ({ accountId, userId: p.userId, displayName: p.displayName || undefined, zaloName: p.zaloName || undefined, avatar: p.avatar || undefined, isBlocked: 1 })))
    })()
  }

  names(accountId: string, userIds: string[]) {
    return this.db
      .query<{ userId: string; name: string | null }, [string, string]>(
        `SELECT userId, COALESCE(NULLIF(alias, ''), NULLIF(displayName, ''), zaloName) AS name FROM user WHERE accountId = ? AND userId IN (SELECT value FROM json_each(?))`,
      )
      .all(accountId, JSON.stringify(userIds))
  }

  upsertUsers(rows: Record<string, unknown>[]) {
    upsert(this.db, 'user', rows)
  }

  set(accountId: string, userId: string, fields: Record<string, unknown>) {
    upsert(this.db, 'user', [{ accountId, userId, ...fields }])
  }
}
