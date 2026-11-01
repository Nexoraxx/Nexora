import type { StickerCategory, StickerDetail } from '@hwqnq/zca-js'
import type { StickerItem, StickerCategoryItem } from '../dtos/responses/sticker.response'
import { EXT_WEBP } from '../constants/sticker.constant'

export const versioned = (url: string, version?: number | null) => (version ? `${url}${url.includes('?') ? '&' : '?'}version=${version}` : url)

// Zalo PC: thumb is the webp (else png); the sprite plays when the sticker is webp or has more than one frame
export const toItem = (s: StickerDetail): StickerItem => ({
  id: s.id,
  cateId: s.cateId,
  type: s.type,
  text: s.text ?? '',
  thumb: versioned(s.stickerWebpUrl ?? s.stickerUrl, s.version),
  anim:
    s.stickerSpriteUrl && (s.ext === EXT_WEBP || s.totalFrames > 1)
      ? { url: versioned(s.stickerSpriteUrl, s.version), frames: s.ext === EXT_WEBP ? 1 : s.totalFrames, duration: s.duration || 250 }
      : null,
})

export const toCategory = (c: StickerCategory): StickerCategoryItem => ({ id: c.id, name: c.name, iconUrl: c.iconUrl, totalImage: c.totalImage })

// Zalo PC store order: type desc, then status desc with status 4 counted as 0
export const storeOrder = (a: StickerCategory, b: StickerCategory) => {
  const status = (c: StickerCategory) => (c.status === 4 ? 0 : c.status)
  return a.type === b.type ? status(b) - status(a) : b.type - a.type
}
