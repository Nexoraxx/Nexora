import type { MediaKind } from '../../dtos/responses/message.response'
import type { Healed, Saved, StoredMessage, ThreadRow } from '../../models/message.model'

export default interface IMessageRepository {
  tagE2ee(): void
  transaction<T>(fn: () => T): T
  ciphertexts(accountId: string): { msgId: string; content: string }[]
  healCiphertexts(accountId: string, rows: Healed[]): void
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
  relation(accountId: string, userId: string): { isFr: number | null; isBlocked: number | null } | null
  avatar(accountId: string, userId: string): string
  isGroup(accountId: string, threadId: string): boolean
}
