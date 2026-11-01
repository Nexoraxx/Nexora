import type { StickerDetail } from '@hwqnq/zca-js'

export type StickerRow = StickerDetail & { fetchTs: number }

export type SuggestResponse = { sugg_sticker?: { sticker_id: number; cate_id: number }[] | null; expired_time?: number }
export type SuggestApi = (props: { keyword: string }) => Promise<SuggestResponse>
export type Personal = { cates: number[]; version: number; removed: number[]; expiresAt: number }
export type Recent = { id: number; cateId: number }
