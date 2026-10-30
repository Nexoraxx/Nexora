import type { AutoDeleteRequest, LabelRequest, MuteRequest } from '../../dtos/requests/conversation.request'
import type { ConversationSettings } from '../../dtos/responses/conversation.response'

export default interface IConversationService {
  settings(accountId: string): ConversationSettings
  ttl(accountId: string, threadId: string): number
  hidden(accountId: string): Set<string>
  pinMatches(accountId: string, pin: string): boolean
  setPinned(accountId: string, threadId: string, isGroup: boolean, pinned: boolean): Promise<void>
  setMute(accountId: string, threadId: string, body: MuteRequest): Promise<void>
  setAutoDelete(accountId: string, threadId: string, body: AutoDeleteRequest): Promise<void>
  setUnread(accountId: string, threadId: string, isGroup: boolean, unread: boolean): Promise<void>
  setArchived(accountId: string, threadId: string, isGroup: boolean, archived: boolean): Promise<void>
  setLabel(accountId: string, threadId: string, isGroup: boolean, labelId: number | null): Promise<void>
  createLabel(accountId: string, body: LabelRequest): Promise<void>
  updateLabel(accountId: string, id: number, body: LabelRequest): Promise<void>
  deleteLabel(accountId: string, id: number): Promise<void>
  setHidden(accountId: string, threadId: string, isGroup: boolean, hidden: boolean, pin?: string): Promise<void>
  verifyPin(accountId: string, pin: string): void
  changePin(accountId: string, oldPin: string, newPin: string): Promise<void>
  resetPin(accountId: string): Promise<string[]>
  forget(accountId: string, threadId: string): void
}
