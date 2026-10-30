import { z } from 'zod'

export const StickerSearchRequest = z.object({ q: z.string().trim().min(1) })
export type StickerSearchRequest = z.infer<typeof StickerSearchRequest>

export const StickerSuggestRequest = z.object({ keyword: z.string().trim().toLowerCase().min(1) })
export type StickerSuggestRequest = z.infer<typeof StickerSuggestRequest>

export const StickerCategoryParam = z.coerce.number().int().min(0)
