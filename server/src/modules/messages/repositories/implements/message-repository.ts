import { inject, injectable } from 'inversify'
import { Database, upsert } from '../../../../dbs/sqlite'
import { TOKENS } from '../../../../di/tokens'
import type { MediaKind } from '../../dtos/responses/message.response'
import type IMessageRepository from '../interfaces/message-repository'
import { E2EE, E2EE_CMDS, E2EE_READ, type Row, type Saved, type StoredMessage, type ThreadRow } from '../interfaces/message-repository'

// Zalo PC turns a recalled message into this type
const UNDONE = 'chat.undo'

const MEDIA: Record<MediaKind, string> = {
  media: `msgType IN ('chat.photo', 'chat.gif', 'chat.video.msg')`,
  file: `msgType = 'share.file'`,
  link: `msgType = 'chat.recommended' AND json_extract(message, '$.action') = 'recommened.link'`,
}

const SELECT_MESSAGES = `SELECT m.*, i.seenUids, i.deliveredUids, r.reactions FROM message m
  LEFT JOIN msg_info i ON i.accountId = m.accountId AND i.msgId = m.msgId
  LEFT JOIN reaction r ON r.accountId = m.accountId AND r.rMsgId = m.msgId`

@injectable()
export default class MessageRepository implements IMessageRepository {
  constructor(@inject(TOKENS.Database) private db: Database) {}

  // encrypted messages stored before they were told apart
  tagE2ee() {
    this.db.run(`UPDATE message SET msgType = '${E2EE}', msgText = NULL WHERE cmd IN (${E2EE_CMDS}) AND msgType != '${E2EE}' AND e2eeStatus IS NOT ${E2EE_READ}`)
    this.db.run(
      `UPDATE preview_message SET messageType = '${E2EE}' WHERE messageType != '${E2EE}'
         AND EXISTS (SELECT 1 FROM message m WHERE m.accountId = preview_message.accountId AND m.msgId = preview_message.msgId AND m.msgType = '${E2EE}')`,
    )
  }

  // Unread = incoming messages newer than the thread's read marker, counted on read so every sync path
  // (live, offline queue, preload, cloud) can store duplicates without double counting.
  // ponytail: counted per query; materialize into unread_conv counters if long thread lists get slow
  threads(accountId: string, limit: number) {
    return this.db
      .query<ThreadRow, [string, number]>(
        `SELECT p.convId AS threadId, p.isGroup, p.msgId, p.messageType AS msgType, p.message, p.fromUid, p.dName, p.messageTime,
           COALESCE(us.alias, us.displayName, g.displayName) AS name, COALESCE(us.avatar, g.avatar) AS avatar,
           EXISTS (SELECT 1 FROM e2ee_metadata e WHERE e.accountId = p.accountId AND e.uid = p.convId AND e.status = 1) AS e2ee,
           (SELECT count(*) FROM message m WHERE m.accountId = p.accountId AND m.toUid = p.convId AND m.fromUid != p.accountId
              AND m.msgType != '${UNDONE}' AND (u.lastProcessMsgId IS NULL OR CAST(m.msgId AS INTEGER) > CAST(u.lastProcessMsgId AS INTEGER))) AS unread
         FROM preview_message p
         LEFT JOIN unread_conv u ON u.accountId = p.accountId AND u.convId = p.convId
         LEFT JOIN user us ON p.isGroup = 0 AND us.accountId = p.accountId AND us.userId = p.convId
         LEFT JOIN groups g ON p.isGroup = 1 AND g.accountId = p.accountId AND g.userId = p.convId
         WHERE p.accountId = ? ORDER BY p.messageTime DESC LIMIT ?`,
      )
      .all(accountId, limit)
  }

  listFrom(accountId: string, threadId: string, sendDttm: number, limit: number) {
    return this.db
      .query<StoredMessage, [string, string, number, number]>(`${SELECT_MESSAGES} WHERE m.accountId = ? AND m.toUid = ? AND m.sendDttm >= ? ORDER BY m.sendDttm DESC LIMIT ?`)
      .all(accountId, threadId, sendDttm, limit)
  }

  listBefore(accountId: string, threadId: string, sendDttm: number, limit: number) {
    return this.db
      .query<StoredMessage, [string, string, number, number]>(`${SELECT_MESSAGES} WHERE m.accountId = ? AND m.toUid = ? AND m.sendDttm < ? ORDER BY m.sendDttm DESC LIMIT ?`)
      .all(accountId, threadId, sendDttm, limit)
  }

  media(accountId: string, threadId: string, kind: MediaKind, limit: number) {
    return this.db
      .query<{ msgId: string; msgType: string; message: string | null; sendDttm: number }, [string, string, number]>(
        `SELECT msgId, msgType, message, sendDttm FROM message WHERE accountId = ? AND toUid = ? AND ${MEDIA[kind]} ORDER BY sendDttm DESC LIMIT ?`,
      )
      .all(accountId, threadId, limit)
  }

  search(params: Record<string, string | number | null>) {
    return this.db
      .query<StoredMessage, Record<string, string | number | null>>(
        `${SELECT_MESSAGES} JOIN message_fts f ON f.rowid = m.rowid
         WHERE f.text MATCH $match AND m.accountId = $accountId AND m.toUid = $threadId AND ($fromUid IS NULL OR m.fromUid = $fromUid)
           AND m.sendDttm > $since AND m.sendDttm < $until
         ORDER BY m.sendDttm DESC LIMIT $limit OFFSET $offset`,
      )
      .all(params)
  }

  starred(accountId: string) {
    return this.db.query<StoredMessage, [string]>(`${SELECT_MESSAGES} WHERE m.accountId = ? AND m.staredDttm IS NOT NULL ORDER BY m.staredDttm DESC`).all(accountId)
  }

  find(accountId: string, msgId: string) {
    return this.db.query<StoredMessage, [string, string]>(`SELECT * FROM message WHERE accountId = ? AND msgId = ?`).get(accountId, msgId)
  }

  findFull(accountId: string, msgId: string) {
    return this.db.query<StoredMessage, [string, string]>(`${SELECT_MESSAGES} WHERE m.accountId = ? AND m.msgId = ?`).get(accountId, msgId)
  }

  last(accountId: string, threadId: string) {
    return this.db
      .query<StoredMessage, [string, string]>(`SELECT * FROM message WHERE accountId = ? AND toUid = ? AND fromUid IS NOT NULL ORDER BY sendDttm DESC LIMIT 1`)
      .get(accountId, threadId)
  }

  lastReceived(accountId: string, threadId: string) {
    return this.db
      .query<StoredMessage, [string, string, string]>(`SELECT * FROM message WHERE accountId = ? AND toUid = ? AND fromUid != ? ORDER BY sendDttm DESC LIMIT 1`)
      .get(accountId, threadId, accountId)
  }

  previews(accountId: string) {
    return this.db
      .query<{ threadId: string; isGroup: number; msgId: string }, [string]>(`SELECT convId AS threadId, isGroup, msgId FROM preview_message WHERE accountId = ?`)
      .all(accountId)
  }

  unmarkedThreads(accountId: string) {
    return this.db
      .query<{ convId: string; isGroup: number }, [string]>(
        `SELECT p.convId, p.isGroup FROM preview_message p LEFT JOIN unread_conv u ON u.accountId = p.accountId AND u.convId = p.convId
         WHERE p.accountId = ? AND u.lastProcessMsgId IS NULL`,
      )
      .all(accountId)
  }

  save(accountId: string, items: Saved[]) {
    this.db.transaction(() => {
      for (const { row, isGroup, isSelf } of items) {
        upsert(this.db, 'message', [row])
        this.updatePreview(row, isGroup)
        // replying from any device means the thread was read
        if (isSelf) this.markRead(accountId, row.toUid, row.msgId)
      }
    })()
  }

  setStarred(accountId: string, msgId: string, starred: boolean) {
    this.db.run(`UPDATE message SET staredDttm = ? WHERE accountId = ? AND msgId = ?`, [starred ? Date.now() : null, accountId, msgId])
  }

  recall(accountId: string, msgId: string) {
    this.db.run(`UPDATE message SET msgType = '${UNDONE}', message = NULL, msgText = NULL, quote = NULL, staredDttm = NULL WHERE accountId = ? AND msgId = ?`, [accountId, msgId])
    this.db.run(`UPDATE preview_message SET messageType = '${UNDONE}', message = NULL WHERE accountId = ? AND msgId = ?`, [accountId, msgId])
  }

  remove(accountId: string, threadId: string, msgId: string) {
    this.db.transaction(() => {
      this.db.run(`DELETE FROM message WHERE accountId = ? AND msgId = ?`, [accountId, msgId])
      this.repairPreview(accountId, threadId)
    })()
  }

  forgetThreads(accountId: string, threadIds: string[]) {
    this.db.transaction(() => {
      for (const id of threadIds)
        for (const sql of [`DELETE FROM message WHERE accountId = ? AND toUid = ?`, `DELETE FROM preview_message WHERE accountId = ? AND convId = ?`, `DELETE FROM unread_conv WHERE accountId = ? AND convId = ?`])
          this.db.run(sql, [accountId, id])
    })()
  }

  // "Tin nhắn tự xóa": PC drops a message once sendDttm + ttl has passed, from the DB too (enable_delete_on_filter)
  purgeExpired(accountId: string) {
    const now = Date.now()
    const threads = this.db.query<{ toUid: string }, [string, number]>(`SELECT DISTINCT toUid FROM message WHERE accountId = ? AND ttl > 0 AND sendDttm + ttl <= ?`).all(accountId, now)
    if (!threads.length) return
    this.db.transaction(() => {
      this.db.run(`DELETE FROM message WHERE accountId = ? AND ttl > 0 AND sendDttm + ttl <= ?`, [accountId, now])
      for (const { toUid } of threads) this.repairPreview(accountId, toUid)
    })()
  }

  // Read marker only moves forward.
  markRead(accountId: string, threadId: string, msgId: string) {
    this.db.run(
      `INSERT INTO unread_conv (accountId, convId, lastProcessMsgId) VALUES (?, ?, ?)
       ON CONFLICT (accountId, convId) DO UPDATE SET lastProcessMsgId = excluded.lastProcessMsgId
       WHERE lastProcessMsgId IS NULL OR CAST(excluded.lastProcessMsgId AS INTEGER) > CAST(lastProcessMsgId AS INTEGER)`,
      [accountId, threadId, msgId],
    )
  }

  receipts(accountId: string, msgId: string) {
    return this.db.query<{ seenUids: string | null; deliveredUids: string | null }, [string, string]>(`SELECT seenUids, deliveredUids FROM msg_info WHERE accountId = ? AND msgId = ?`).get(accountId, msgId)
  }

  saveReceipts(row: { accountId: string; msgId: string; seenUids?: string[]; deliveredUids?: string[] }) {
    upsert(this.db, 'msg_info', [row])
  }

  reaction(accountId: string, msgId: string) {
    return this.db.query<{ reactions: string | null }, [string, string]>(`SELECT reactions FROM reaction WHERE accountId = ? AND rMsgId = ?`).get(accountId, msgId)
  }

  saveReaction(row: Record<string, unknown>) {
    upsert(this.db, 'reaction', [row])
  }

  cursor(accountId: string, key: string) {
    // Zalo PC starts an empty queue cursor at "1"
    return this.db.query<{ val: string }, [string, string]>(`SELECT val FROM kv WHERE accountId = ? AND key = ?`).get(accountId, key)?.val ?? '1'
  }

  setCursor(accountId: string, key: string, val: string) {
    upsert(this.db, 'kv', [{ accountId, key, val }])
  }

  groupMembers(accountId: string, groupId: string) {
    return this.db.query<{ memberIds: string | null }, [string, string]>(`SELECT memberIds FROM group_info WHERE accountId = ? AND userId = ?`).get(accountId, groupId)
  }

  group(accountId: string, groupId: string) {
    return this.db
      .query<{ setting: string | null; creatorId: string | null }, [string, string]>(
        `SELECT i.setting, g.creatorId FROM groups g LEFT JOIN group_info i ON i.accountId = g.accountId AND i.userId = g.userId WHERE g.accountId = ? AND g.userId = ?`,
      )
      .get(accountId, groupId)
  }

  phoneNumber(accountId: string, userId: string) {
    return this.db.query<{ phoneNumber: string | null }, [string, string]>(`SELECT phoneNumber FROM user WHERE accountId = ? AND userId = ?`).get(accountId, userId)
  }

  displayName(accountId: string, userId: string) {
    return this.db.query<{ name: string | null }, [string, string]>(`SELECT COALESCE(alias, displayName) AS name FROM user WHERE accountId = ? AND userId = ?`).get(accountId, userId)?.name ?? null
  }

  avatar(accountId: string, userId: string) {
    return this.db.query<{ avatar: string | null }, [string, string]>(`SELECT avatar FROM user WHERE accountId = ? AND userId = ?`).get(accountId, userId)?.avatar ?? ''
  }

  isGroup(accountId: string, threadId: string) {
    return !!this.db
      .query(
        `SELECT 1 WHERE EXISTS (SELECT 1 FROM groups WHERE accountId = $a AND userId = $t)
           OR EXISTS (SELECT 1 FROM preview_message WHERE accountId = $a AND convId = $t AND isGroup = 1)`,
      )
      .get({ a: accountId, t: threadId })
  }

  private updatePreview(row: Row, isGroup: boolean) {
    this.db
      .query(
        `INSERT INTO preview_message (accountId, convId, msgId, cliMsgId, fromUid, toUid, dName, isGroup, message, messageType, messageTime)
         VALUES ($accountId, $convId, $msgId, $cliMsgId, $fromUid, $convId, $dName, $isGroup, $message, $msgType, $sendDttm)
         ON CONFLICT (accountId, convId) DO UPDATE SET msgId = excluded.msgId, cliMsgId = excluded.cliMsgId, fromUid = excluded.fromUid,
           dName = excluded.dName, message = excluded.message, messageType = excluded.messageType, messageTime = excluded.messageTime
         WHERE excluded.messageTime >= preview_message.messageTime`,
      )
      .run({
        accountId: row.accountId,
        convId: row.toUid,
        msgId: row.msgId,
        cliMsgId: row.cliMsgId ?? null,
        fromUid: row.fromUid,
        dName: row.dName ?? null,
        isGroup: Number(isGroup),
        message: row.message,
        msgType: row.msgType,
        sendDttm: row.sendDttm,
      })
  }

  // after messages are removed, the thread's preview falls back to its newest remaining message
  private repairPreview(accountId: string, threadId: string) {
    const preview = this.db.query<{ msgId: string; isGroup: number }, [string, string]>(`SELECT msgId, isGroup FROM preview_message WHERE accountId = ? AND convId = ?`).get(accountId, threadId)
    if (!preview || this.find(accountId, preview.msgId)) return
    this.db.run(`DELETE FROM preview_message WHERE accountId = ? AND convId = ?`, [accountId, threadId])
    const latest = this.db.query<StoredMessage, [string, string]>(`SELECT * FROM message WHERE accountId = ? AND toUid = ? ORDER BY sendDttm DESC LIMIT 1`).get(accountId, threadId)
    if (latest) this.updatePreview(latest, !!preview.isGroup)
  }
}
