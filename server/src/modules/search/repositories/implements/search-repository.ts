import { inject, injectable } from 'inversify'
import { Database } from '../../../../dbs/sqlite'
import { TOKENS } from '../../../../di/tokens'
import type ISearchRepository from '../interfaces/search-repository'
import type { ContactRow, MessageHit } from '../interfaces/search-repository'

@injectable()
export default class SearchRepository implements ISearchRepository {
  constructor(@inject(TOKENS.Database) private db: Database) {}

  contacts(accountId: string) {
    return this.db
      .query<ContactRow, [string, string]>(
        `SELECT u.userId, 0 AS isGroup, u.alias, u.displayName, u.zaloName, u.avatar, u.isFr, p.messageTime AS last FROM user u
           LEFT JOIN preview_message p ON p.accountId = u.accountId AND p.convId = u.userId
           WHERE u.accountId = ? AND (u.isFr = 1 OR p.convId IS NOT NULL)
         UNION ALL
         SELECT g.userId, 1, NULL, g.displayName, NULL, g.avatar, 0, p.messageTime FROM groups g
           LEFT JOIN preview_message p ON p.accountId = g.accountId AND p.convId = g.userId
           WHERE g.accountId = ?`,
      )
      .all(accountId, accountId)
  }

  messages(accountId: string, words: string, files: boolean, limit: number) {
    return this.db
      .query<MessageHit, Record<string, string | number>>(
        `SELECT m.msgId, m.toUid AS threadId, (g.userId IS NOT NULL OR p.isGroup = 1) AS isGroup, COALESCE(us.alias, us.displayName, g.displayName) AS threadName,
           COALESCE(us.avatar, g.avatar) AS threadAvatar, m.fromUid, m.dName, m.msgType, m.message, m.sendDttm
         FROM message_fts f JOIN message m ON m.rowid = f.rowid
         LEFT JOIN preview_message p ON p.accountId = m.accountId AND p.convId = m.toUid
         LEFT JOIN user us ON us.accountId = m.accountId AND us.userId = m.toUid
         LEFT JOIN groups g ON g.accountId = m.accountId AND g.userId = m.toUid
         WHERE f.text MATCH $match AND m.accountId = $accountId AND (m.msgType = 'share.file') = $files
           AND (m.ttl IS NULL OR m.ttl = 0 OR m.sendDttm + m.ttl > $now)
         ORDER BY m.sendDttm DESC LIMIT $limit`,
      )
      .all({ match: `"${words}"*`, accountId, files: Number(files), now: Date.now(), limit })
  }

  group(accountId: string, id: string) {
    return this.db.query<{ displayName: string | null; avatar: string | null }, [string, string]>(`SELECT displayName, avatar FROM groups WHERE accountId = ? AND userId = ?`).get(accountId, id)
  }

  user(accountId: string, id: string) {
    return this.db
      .query<{ name: string | null; avatar: string | null; isFr: number }, [string, string]>(`SELECT COALESCE(alias, displayName) AS name, avatar, isFr FROM user WHERE accountId = ? AND userId = ?`)
      .get(accountId, id)
  }
}
