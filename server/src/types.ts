import { AccountStatus } from "./modules/accounts/dtos/responses/account.response";
import type { MessageRow, ReactionCount } from "./modules/messages/dtos/responses/message.response";

export type * from './modules/accounts/dtos/responses/account.response'
export type * from './modules/auto-replies/dtos/responses/auto-reply.response'
export type * from './modules/boards/dtos/responses/board.response'
export type * from './modules/contacts/dtos/responses/contact.response'
export type * from './modules/conversations/dtos/responses/conversation.response'
export type * from './modules/groups/dtos/responses/group.response'
export type * from './modules/messages/dtos/responses/message.response'
export type * from './modules/pins/dtos/responses/pin.response'
export type * from './modules/quick-messages/dtos/responses/quick-message.response'
export type * from './modules/search/dtos/responses/search.response'
export type * from './modules/settings/dtos/responses/settings.response'
export type * from './modules/stickers/dtos/responses/sticker.response'
export type * from './modules/todos/dtos/responses/todo.response'

export type ServerEvent =
  | { type: 'qr'; image: string }
  | { type: 'qr-scanned'; name: string; avatar: string }
  | { type: 'qr-failed' }
  | { type: 'qr-done'; id: string }
  | { type: 'account'; id: string; status: AccountStatus }
  | { type: 'profile'; id: string; name: string; avatar: string | null }
  | { type: 'contacts'; accountId: string }
  | { type: 'message'; message: MessageRow }
  | { type: 'undo'; accountId: string; msgId: string }
  | { type: 'reaction'; accountId: string; threadId: string; msgId: string; reactions: ReactionCount[] }
  | { type: 'threads'; accountId: string }
  | { type: 'conversations'; accountId: string }
  // own privacy settings changed (here or on another device)
  | { type: 'settings'; accountId: string }
  // "Tin nhắn nhanh" changed (here or on another device)
  | { type: 'quick_messages'; accountId: string }
  // "Trả lời tự động" rules changed (here or on another device)
  | { type: 'auto_replies'; accountId: string }
  // To-Do changed (here, or a "chat.todo" message from any device): an open todo list reloads
  | { type: 'todos'; accountId: string }
  // a "Gửi hàng loạt" run started, moved on or changed state: open lists reload
  | { type: 'bulk_sends'; accountId: string }
  // a group's details changed (group event from any device): an open members panel reloads
  | { type: 'group'; accountId: string; groupId: string }
  | { type: 'receipt'; accountId: string; threadId: string }
  | { type: 'typing'; accountId: string; threadId: string; userId: string; name: string | null }
  // pinned messages of a thread changed (anyone, any device): an open pin bar reloads
  | { type: 'pins'; accountId: string; threadId: string }
  // notes, polls or reminders of a thread changed (anyone, any device): an open board reloads
  | { type: 'board'; accountId: string; threadId: string }
  | ({ type: 'sync_status'; accountId: string } & SyncState)