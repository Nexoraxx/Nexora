export type StickerItem = {
  id: number
  cateId: number
  type: number
  text: string
  thumb: string
  // frames > 1: horizontal sprite strip played at `duration` ms per frame; frames = 1: url is itself animated (webp/gif)
  anim: { url: string; frames: number; duration: number } | null
}
export type StickerCategoryItem = { id: number; name: string; iconUrl: string; totalImage: number; added?: boolean }
