import { inject, injectable } from 'inversify'
import { Database } from '../../../../dbs/sqlite'
import { TOKENS } from '../../../../di/tokens'
import type { TodoPerson } from '../../dtos/responses/todo.response'
import type ITodoRepository from '../interfaces/todo-repository'

@injectable()
export default class TodoRepository implements ITodoRepository {
  constructor(@inject(TOKENS.Database) private db: Database) {}

  message(accountId: string, msgId: string) {
    return this.db
      .query<{ cliMsgId: string | null; fromUid: string | null; msgType: string; mentions: string | null }, [string, string]>(
        `SELECT cliMsgId, fromUid, msgType, mentions FROM message WHERE accountId = ? AND msgId = ?`,
      )
      .get(accountId, msgId)
  }

  cliMsgId(accountId: string, msgId: string) {
    return this.db.query<{ cliMsgId: string | null }, [string, string]>(`SELECT cliMsgId FROM message WHERE accountId = ? AND msgId = ?`).get(accountId, msgId)
  }

  names(accountId: string, table: 'user' | 'groups', ids: string[]) {
    const name = table === 'user' ? `COALESCE(NULLIF(alias, ''), displayName, zaloName, userId)` : `COALESCE(displayName, userId)`
    return this.db
      .query<TodoPerson, [string, string]>(`SELECT userId, ${name} AS name, COALESCE(avatar, '') AS avatar FROM ${table} WHERE accountId = ? AND userId IN (SELECT value FROM json_each(?))`)
      .all(accountId, JSON.stringify([...new Set(ids)]))
  }
}
