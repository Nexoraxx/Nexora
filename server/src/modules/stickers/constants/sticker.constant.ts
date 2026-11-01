import type { StickerItem, StickerCategoryItem } from '../dtos/responses/sticker.response'

// Zalo PC sticker constants (renderer module ynGT)
export const BUILTIN_CATE = 0
 // "Củ hành", shipped with the app
export const BUILTIN_COUNT = 30
export const BUILTIN_BASE = 'https://stc-chat.zdn.vn/images/stickers/default/'
export const CATALOG_SALT = 'qebjuzwihygr'
 // dataUrl is trusted only when md5(text + salt) === cs
export const MAX_RECENT = 12
export const EXT_WEBP = 2
 // STICKER_EXT { PNG: 0, JPG: 1, WEBP: 2 }
export const DAY = 24 * 3600e3
// ponytail: a category's stickers are refetched weekly; Zalo compares the category version instead
export const STICKERS_STALE = 7 * DAY
// registered on each API instance via zca's custom(); zca's getStickers hits an older path
export const SUGGEST_API = 'nexoraStickerSuggest'

export const BUILTIN: StickerItem[] = Array.from({ length: BUILTIN_COUNT }, (_, i) => ({
  id: i + 1,
  cateId: BUILTIN_CATE,
  type: 7,
  text: '',
  thumb: `${BUILTIN_BASE}thumb/${i + 1}.png`,
  anim: { url: `${BUILTIN_BASE}${i + 1}.gif`, frames: 1, duration: 0 },
}))
export const BUILTIN_CATEGORY: StickerCategoryItem = { id: BUILTIN_CATE, name: 'Củ hành', iconUrl: BUILTIN[0].thumb, totalImage: BUILTIN_COUNT }
