import type { MediaKind, Thread } from '../../dtos/responses/message.response'

// Zalo PC's SignalCommands.MSG RECEIVE_ONEONE / RECEIVE_GROUP: end-to-end encrypted (Signal) messages, which zca
// passes on as text. Without this device's Signal keys (PC registers its own) they can't be read: they're kept as
// chat.e2ee, ciphertext out of search.
// ponytail: no E2EE; reading these needs PC's key registration (SignalCommands.INIT) and a Signal session store
export const E2EE_CMDS = [551, 552]
export const E2EE = 'chat.e2ee'

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
}
export type ThreadRow = Omit<Thread, 'isGroup' | 'content'> & { isGroup: number; message: string | null }

export default interface IMessageRepository {
  tagE2ee(): void
  threads(accountId: string, limit: number): ThreadRow[]
  // a message and everything newer, oldest last
  listFrom(accountId: string, threadId: string, sendDttm: number, limit: number): StoredMessage[]
  listBefore(accountId: string, threadId: string, sendDttm: number, limit: number): StoredMessage[]
  media(accountId: string, threadId: string, kind: MediaKind, limit: number): { msgId: string; msgType: string; message: string | null; sendDttm: number }[]
  search(params: Record<string, string | number | null>): StoredMessage[]
  starred(accountId: string): StoredMessage[]
  find(accountId: string, msgId: string): StoredMessage | null
  // with receipts and reactions
  findFull(accountId: string, msgId: string): StoredMessage | null
  // newest message with a sender
  last(accountId: string, threadId: string): StoredMessage | null
  lastReceived(accountId: string, threadId: string): StoredMessage | null
  previews(accountId: string): { threadId: string; isGroup: number; msgId: string }[]
  // threads without a read marker
  unmarkedThreads(accountId: string): { convId: string; isGroup: number }[]
  save(accountId: string, items: Saved[]): void
  setStarred(accountId: string, msgId: string, starred: boolean): void
  recall(accountId: string, msgId: string): void
  remove(accountId: string, threadId: string, msgId: string): void
  forgetThreads(accountId: string, threadIds: string[]): void
  purgeExpired(accountId: string): void
  markRead(accountId: string, threadId: string, msgId: string): void
  receipts(accountId: string, msgId: string): { seenUids: string | null; deliveredUids: string | null } | null
  saveReceipts(row: { accountId: string; msgId: string; seenUids?: string[]; deliveredUids?: string[] }): void
  reaction(accountId: string, msgId: string): { reactions: string | null } | null
  saveReaction(row: Record<string, unknown>): void
  cursor(accountId: string, key: string): string
  setCursor(accountId: string, key: string, val: string): void
  groupMembers(accountId: string, groupId: string): { memberIds: string | null } | null
  group(accountId: string, groupId: string): { setting: string | null; creatorId: string | null } | null
  phoneNumber(accountId: string, userId: string): { phoneNumber: string | null } | null
  displayName(accountId: string, userId: string): string | null
  avatar(accountId: string, userId: string): string
  isGroup(accountId: string, threadId: string): boolean
}
