import { inject, injectable } from 'inversify'
import type { StickerDetail } from '@hwqnq/zca-js'
import { Database, upsert } from '../../../../dbs/sqlite'
import { TOKENS } from '../../../../di/tokens'
import type IStickerRepository from '../interfaces/sticker-repository'
import type { StickerRow } from '../../models/sticker.model'

@injectable()
export default class StickerRepository implements IStickerRepository {
  constructor(@inject(TOKENS.Database) private db: Database) {}

  fresh(cateId: number, since: number) {
    return this.db.query<StickerRow, [number, number]>(`SELECT * FROM sticker WHERE cateId = ? AND fetchTs > ? ORDER BY id`).all(cateId, since)
  }

  cache(details: StickerDetail[]) {
    upsert(this.db, 'sticker', details.map((s) => ({ ...s, fetchTs: Date.now() })))
  }

  row(cateId: number, id: number) {
    return this.db.query<StickerRow, [number, number]>(`SELECT * FROM sticker WHERE cateId = ? AND id = ?`).get(cateId, id) ?? undefined
  }

  kvGet<T>(accountId: string, key: string): T | undefined {
    const val = this.db.query<{ val: string }, [string, string]>(`SELECT val FROM kv WHERE accountId = ? AND key = ?`).get(accountId, key)?.val
    return val ? JSON.parse(val) : undefined
  }

  kvSet(accountId: string, key: string, value: unknown) {
    upsert(this.db, 'kv', [{ accountId, key, val: JSON.stringify(value) }])
  }
}
