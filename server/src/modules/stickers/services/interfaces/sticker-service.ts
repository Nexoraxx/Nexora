import type { StickerCategoryItem, StickerItem } from '../../dtos/responses/sticker.response'

export default interface IStickerService {
  categories(accountId: string): Promise<StickerCategoryItem[]>
  store(accountId: string): Promise<{ added: boolean; id: number; name: string; iconUrl: string; totalImage: number }[]>
  stickers(accountId: string, cateId: number): Promise<StickerItem[]>
  recent(accountId: string): StickerItem[]
  search(accountId: string, keyword: string): Promise<StickerItem[]>
  suggestKeywords(accountId: string): Promise<{ keywords: string[]; maxWords: number }>
  suggest(accountId: string, keyword: string): Promise<StickerItem[]>
  setAdded(accountId: string, cateId: number, added: boolean): Promise<void>
}
