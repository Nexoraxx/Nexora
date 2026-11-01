export type Media = { items?: { type?: number; thumbUrl?: string; rawUrl?: string; hdUrl?: string; normalUrl?: string }[] } | null
export type Item = { id: number | string; keyword: string; type: number; message?: { title?: string; params?: string } | null; media?: Media; lastModified?: number }
