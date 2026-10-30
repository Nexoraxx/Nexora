export type ReactionCount = { icon: string; count: number; mine: boolean }

export type MessageRow = {
  accountId: string
  threadId: string
  msgId: string
  cliMsgId: string | null
  fromUid: string | null
  dName: string | null
  // zca msgType: 'webchat', 'chat.photo', 'share.file', 'chat.sticker', ...; 'chat.undo' once recalled
  msgType: string
  sendDttm: number
  content: unknown
  quote: unknown
  mentions: unknown
  ttl: number | null
  starred: boolean
  reactions: ReactionCount[]
  seenUids: string[]
  deliveredUids: string[]
  e2eeStatus?: number
}

export type Thread = {
  threadId: string
  isGroup: boolean
  name: string | null
  avatar: string | null
  msgId: string
  msgType: string
  content: unknown
  fromUid: string | null
  dName: string | null
  messageTime: number
  unread: number
  e2eeStatus?: number
}

export type MessagePerson = { userId: string; name: string; avatar: string }
// "Thông tin tin nhắn": hidden = group too big for PC to list who has seen / received
export type MessageInfo = { seen: MessagePerson[]; delivered: MessagePerson[]; hidden: boolean; maxMembers: number }

// Zalo PC composer link preview (parselink); href is the URL as typed, with https:// added when missing
export type LinkPreview = { href: string; title: string; desc: string; thumb: string; src: string; media: { type?: number; [key: string]: unknown } | null }

export type MediaKind = 'media' | 'file' | 'link'
