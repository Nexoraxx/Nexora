import type { StickerDetail } from '@hwqnq/zca-js'
import type { StickerRow } from '../../models/sticker.model'

export default interface IStickerRepository {
  // a category's stickers fetched after `since`
  fresh(cateId: number, since: number): StickerRow[]
  cache(details: StickerDetail[]): void
  row(cateId: number, id: number): StickerRow | undefined
  kvGet<T>(accountId: string, key: string): T | undefined
  kvSet(accountId: string, key: string, value: unknown): void
}
