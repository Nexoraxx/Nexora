import { inject, injectable } from 'inversify'
import { Database } from '../../../../dbs/sqlite'
import { TOKENS } from '../../../../di/tokens'
import type { Person } from '../../dtos/responses/board.response'
import type IBoardRepository from '../interfaces/board-repository'

@injectable()
export default class BoardRepository implements IBoardRepository {
  constructor(@inject(TOKENS.Database) private db: Database) {}

  people(accountId: string, ids: string[]) {
    return this.db
      .query<Person, [string, string]>(
        `SELECT userId, COALESCE(NULLIF(alias, ''), displayName, zaloName, userId) AS name, COALESCE(avatar, '') AS avatar
         FROM user WHERE accountId = ? AND userId IN (SELECT value FROM json_each(?))`,
      )
      .all(accountId, JSON.stringify(ids))
  }

  group(accountId: string, groupId: string) {
    return this.db
      .query<{ creatorId: string | null; adminIds: string | null }, [string, string]>(
        `SELECT g.creatorId, i.adminIds FROM groups g LEFT JOIN group_info i ON i.accountId = g.accountId AND i.userId = g.userId WHERE g.accountId = ? AND g.userId = ?`,
      )
      .get(accountId, groupId)
  }
}
