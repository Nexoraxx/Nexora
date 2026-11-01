import { inject, injectable } from 'inversify'
import { Database } from '../../../../dbs/sqlite'
import { TOKENS } from '../../../../di/tokens'
import type { Speed } from '../../constants/bulk-send.constant'
import type { BulkSend, BulkSendState, BulkTemplate, Recipient, RecipientState } from '../../dtos/responses/bulk-send.response'
import type IBulkSendRepository from '../interfaces/bulk-send-repository'
import type { Friend, Next } from '../../models/bulk-send.model'

const SEND = `SELECT s.id, s.accountId, s.name, s.state, s.pauseReason, s.createdAt,
  COUNT(r.userId) AS total, COALESCE(SUM(r.state = 'sent'), 0) AS sent, COALESCE(SUM(r.state = 'failed'), 0) AS failed,
  COALESCE(SUM(r.state IN ('pending', 'sending')), 0) AS pending
  FROM bulk_send s LEFT JOIN bulk_send_recipient r ON r.sendId = s.id`

@injectable()
export default class BulkSendRepository implements IBulkSendRepository {
  constructor(@inject(TOKENS.Database) private db: Database) {
    try {
      this.db.run(`ALTER TABLE bulk_send ADD COLUMN speed TEXT NOT NULL DEFAULT 'normal'`)
    } catch {}
  }

  templates() {
    return this.db.query<BulkTemplate, []>(`SELECT id, name, body, updatedAt FROM bulk_template ORDER BY updatedAt DESC`).all()
  }

  createTemplate(name: string, body: string) {
    return Number(this.db.query(`INSERT INTO bulk_template (name, body, updatedAt) VALUES (?, ?, ?)`).run(name, body, Date.now()).lastInsertRowid)
  }

  updateTemplate(id: number, name: string, body: string) {
    return this.db.query(`UPDATE bulk_template SET name = ?, body = ?, updatedAt = ? WHERE id = ?`).run(name, body, Date.now(), id).changes > 0
  }

  removeTemplate(id: number) {
    this.db.run(`DELETE FROM bulk_template WHERE id = ?`, [id])
  }

  friends(accountId: string, userIds: string[]) {
    return this.db
      .query<Friend, [string, string]>(
        `SELECT u.userId, u.displayName, u.zaloName, u.alias, u.gender, u.phoneNumber
         FROM json_each(?2) j JOIN user u ON u.accountId = ?1 AND u.userId = j.value
         WHERE u.isFr = 1 AND COALESCE(u.isBlocked, 0) = 0 ORDER BY j.key`,
      )
      .all(accountId, JSON.stringify([...new Set(userIds)]))
  }

  accountName(accountId: string) {
    return this.db.query<{ name: string }, [string]>(`SELECT name FROM account WHERE id = ?`).get(accountId)?.name ?? ''
  }

  sends(accountId: string) {
    return this.db.query<BulkSend, [string]>(`${SEND} WHERE s.accountId = ? GROUP BY s.id ORDER BY s.createdAt DESC`).all(accountId)
  }

  send(accountId: string, id: number) {
    return this.db.query<BulkSend, [string, number]>(`${SEND} WHERE s.accountId = ? AND s.id = ? GROUP BY s.id`).get(accountId, id)
  }

  state(id: number) {
    return this.db.query<{ accountId: string; state: BulkSendState; speed: Speed }, [number]>(`SELECT accountId, state, COALESCE(speed, 'normal') AS speed FROM bulk_send WHERE id = ?`).get(id)
  }

  runningOther(accountId: string, id = -1) {
    return !!this.db.query(`SELECT 1 FROM bulk_send WHERE accountId = ? AND state = 'running' AND id <> ?`).get(accountId, id)
  }

  create(accountId: string, name: string, recipients: { userId: string; text: string }[], speed: Speed = 'normal') {
    return this.db.transaction(() => {
      const id = Number(
        this.db.query(`INSERT INTO bulk_send (accountId, name, state, speed, createdAt) VALUES (?, ?, 'running', ?, ?)`).run(accountId, name, speed, Date.now()).lastInsertRowid,
      )
      const add = this.db.query(`INSERT INTO bulk_send_recipient (sendId, userId, seq, text) VALUES (?, ?, ?, ?)`)
      recipients.forEach((r, i) => add.run(id, r.userId, i, r.text))
      return id
    })()
  }

  recipients(sendId: number) {
    return this.db
      .query<Recipient, [number]>(
        `SELECT r.userId, COALESCE(NULLIF(u.alias, ''), u.displayName, u.zaloName, r.userId) AS name, COALESCE(u.avatar, '') AS avatar,
           r.text, r.state, r.error, r.sentAt
         FROM bulk_send_recipient r JOIN bulk_send s ON s.id = r.sendId
         LEFT JOIN user u ON u.accountId = s.accountId AND u.userId = r.userId
         WHERE r.sendId = ? ORDER BY r.seq`,
      )
      .all(sendId)
  }

  setState(id: number, state: BulkSendState, pauseReason: string | null = null) {
    this.db.run(`UPDATE bulk_send SET state = ?, pauseReason = ? WHERE id = ?`, [state, pauseReason, id])
  }

  next(sendId: number) {
    return this.db
      .query<Next, [number]>(
        `SELECT r.sendId, s.accountId, r.userId, r.text FROM bulk_send_recipient r JOIN bulk_send s ON s.id = r.sendId
         WHERE r.sendId = ? AND s.state = 'running' AND r.state = 'pending' ORDER BY r.seq LIMIT 1`,
      )
      .get(sendId)
  }

  mark(sendId: number, userId: string, state: RecipientState, extra: { error?: string; msgId?: string; sentAt?: number } = {}) {
    this.db.run(`UPDATE bulk_send_recipient SET state = ?, error = ?, msgId = ?, sentAt = ? WHERE sendId = ? AND userId = ?`, [
      state,
      extra.error ?? null,
      extra.msgId ?? null,
      extra.sentAt ?? null,
      sendId,
      userId,
    ])
  }

  skipPending(sendId: number) {
    this.db.run(`UPDATE bulk_send_recipient SET state = 'skipped' WHERE sendId = ? AND state = 'pending'`, [sendId])
  }

  recover(reason: string) {
    return this.db.transaction(() => {
      this.db.run(`UPDATE bulk_send_recipient SET state = 'unknown' WHERE state = 'sending'`)
      return this.db
        .query<{ id: number }, [string]>(`UPDATE bulk_send SET state = 'paused', pauseReason = ? WHERE state = 'running' RETURNING id`)
        .all(reason)
        .map((r) => r.id)
    })()
  }
}
