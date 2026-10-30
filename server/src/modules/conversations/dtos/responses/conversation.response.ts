// a "Phân loại" label; conversations are bare thread ids
export type Label = { id: number; text: string; color: string; emoji: string; conversations: string[] }
export type ConversationSettings = {
  pinned: string[]
  muted: Record<string, number>
  ttl: Record<string, number>
  unread: string[]
  archived: string[]
  labels: Label[]
  hidden: string[]
  hasPin: boolean
}
