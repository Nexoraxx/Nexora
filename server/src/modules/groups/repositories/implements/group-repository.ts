import { inject, injectable } from 'inversify'
import { Database } from '../../../../dbs/sqlite'
import { TOKENS } from '../../../../di/tokens'
import type IGroupRepository from '../interfaces/group-repository'

@injectable()
export default class GroupRepository implements IGroupRepository {
  constructor(@inject(TOKENS.Database) private db: Database) {}

  groupNames(accountId: string) {
    return this.db.query<{ userId: string; displayName: string }, [string]>(`SELECT userId, displayName FROM groups WHERE accountId = ?`).all(accountId)
  }

  hasGroup(accountId: string, groupId: string) {
    return !!this.db.query(`SELECT 1 FROM groups WHERE accountId = ? AND userId = ?`).get(accountId, groupId)
  }

  setting(accountId: string, groupId: string) {
    return this.db.query<{ setting: string | null }, [string, string]>(`SELECT setting FROM group_info WHERE accountId = ? AND userId = ?`).get(accountId, groupId)
  }

  userNames(accountId: string, userIds: string[], prefer: 'alias' | 'zaloName') {
    return this.db
      .query<{ userId: string; name: string | null }, [string, string]>(
        `SELECT userId, ${prefer === 'alias' ? "COALESCE(NULLIF(alias, ''), displayName, zaloName)" : "COALESCE(NULLIF(zaloName, ''), displayName)"} AS name
         FROM user WHERE accountId = ? AND userId IN (SELECT value FROM json_each(?))`,
      )
      .all(accountId, JSON.stringify(userIds))
  }
}
