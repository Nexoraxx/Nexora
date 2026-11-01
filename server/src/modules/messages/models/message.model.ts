import type { Thread } from '../dtos/responses/message.response'

export type Row = {
  accountId: string
  msgId: string
  cliMsgId?: string
  toUid: string // thread id
  fromUid: string | null // null: system message
  dName?: string
  msgType: string
  sendDttm: number
  message: string // content as JSON
  msgText?: string | null
  [column: string]: unknown
}
export type Healed = { msgId: string; message: string; msgText: string | null; quote: string | null }
export type Saved = { row: Row; isGroup: boolean; isSelf: boolean }
export type StoredMessage = Row & {
  cliMsgId: string | null
  quote: string | null
  mentions: string | null
  properties: string | null
  ttl: number | null
  st: number | null
  at: number | null
  cmd: number | null
  staredDttm: number | null
  e2eeStatus: number | null
}
export type ThreadRow = Omit<Thread, 'isGroup' | 'content' | 'e2ee'> & { isGroup: number; message: string | null; e2ee: number }
// stored content of attachment messages (photo, file, link, card, sticker, ...); params is a JSON string
export type Attachment = { title?: string; description?: string; href?: string; thumb?: string; action?: string; params?: unknown; id?: number; catId?: number; type?: number }

export type ReactionMap = Record<string, { icons: Record<string, number>; lastId: string }>
