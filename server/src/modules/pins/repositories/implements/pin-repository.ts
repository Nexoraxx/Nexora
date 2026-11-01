import { inject, injectable } from 'inversify'
import { Database } from '../../../../dbs/sqlite'
import { TOKENS } from '../../../../di/tokens'
import type IPinRepository from '../interfaces/pin-repository'
import type { GroupPinSetting, PinMessage } from '../../models/pin.model'

@injectable()
export default class PinRepository implements IPinRepository {
  constructor(@inject(TOKENS.Database) private db: Database) {}

  message(accountId: string, msgId: string) {
    return this.db
      .query<PinMessage, [string, string]>(`SELECT msgId, cliMsgId, fromUid, dName, msgType, message, msgText, toUid FROM message WHERE accountId = ? AND msgId = ?`)
      .get(accountId, msgId)
  }

  groupSetting(accountId: string, groupId: string) {
    return this.db
      .query<GroupPinSetting, [string, string]>(
        `SELECT i.setting, i.adminIds, g.creatorId FROM groups g LEFT JOIN group_info i ON i.accountId = g.accountId AND i.userId = g.userId WHERE g.accountId = ? AND g.userId = ?`,
      )
      .get(accountId, groupId)
  }

  name(accountId: string, userId: string) {
    return this.db.query<{ name: string | null }, [string, string]>(`SELECT COALESCE(alias, displayName) AS name FROM user WHERE accountId = ? AND userId = ?`).get(accountId, userId)?.name ?? null
  }

  isGroup(accountId: string, threadId: string) {
    return !!this.db.query(`SELECT 1 FROM groups WHERE accountId = ? AND userId = ?`).get(accountId, threadId)
  }
}
