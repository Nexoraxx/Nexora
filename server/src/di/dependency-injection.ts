import { Container } from 'inversify'
import { config } from '../config'
import { Database, openDatabase } from '../dbs/sqlite'
import AccountRepository from '../modules/accounts/repositories/implements/account-repository'
import type IAccountRepository from '../modules/accounts/repositories/interfaces/account-repository'
import AccountService from '../modules/accounts/services/implements/account-service'
import type IAccountService from '../modules/accounts/services/interfaces/account-service'
import AutoReplyService from '../modules/auto-replies/services/implements/auto-reply-service'
import type IAutoReplyService from '../modules/auto-replies/services/interfaces/auto-reply-service'
import BoardRepository from '../modules/boards/repositories/implements/board-repository'
import type IBoardRepository from '../modules/boards/repositories/interfaces/board-repository'
import BoardService from '../modules/boards/services/implements/board-service'
import type IBoardService from '../modules/boards/services/interfaces/board-service'
import BulkSendRepository from '../modules/bulk-sends/repositories/implements/bulk-send-repository'
import type IBulkSendRepository from '../modules/bulk-sends/repositories/interfaces/bulk-send-repository'
import BulkSendService from '../modules/bulk-sends/services/implements/bulk-send-service'
import type IBulkSendService from '../modules/bulk-sends/services/interfaces/bulk-send-service'
import ContactRepository from '../modules/contacts/repositories/implements/contact-repository'
import type IContactRepository from '../modules/contacts/repositories/interfaces/contact-repository'
import ContactService from '../modules/contacts/services/implements/contact-service'
import type IContactService from '../modules/contacts/services/interfaces/contact-service'
import ConversationRepository from '../modules/conversations/repositories/implements/conversation-repository'
import type IConversationRepository from '../modules/conversations/repositories/interfaces/conversation-repository'
import ConversationService from '../modules/conversations/services/implements/conversation-service'
import type IConversationService from '../modules/conversations/services/interfaces/conversation-service'
import GroupRepository from '../modules/groups/repositories/implements/group-repository'
import type IGroupRepository from '../modules/groups/repositories/interfaces/group-repository'
import GroupService from '../modules/groups/services/implements/group-service'
import type IGroupService from '../modules/groups/services/interfaces/group-service'
import MessageRepository from '../modules/messages/repositories/implements/message-repository'
import type IMessageRepository from '../modules/messages/repositories/interfaces/message-repository'
import MessageService from '../modules/messages/services/implements/message-service'
import type IMessageService from '../modules/messages/services/interfaces/message-service'
import PinRepository from '../modules/pins/repositories/implements/pin-repository'
import type IPinRepository from '../modules/pins/repositories/interfaces/pin-repository'
import PinService from '../modules/pins/services/implements/pin-service'
import type IPinService from '../modules/pins/services/interfaces/pin-service'
import QuickMessageService from '../modules/quick-messages/services/implements/quick-message-service'
import type IQuickMessageService from '../modules/quick-messages/services/interfaces/quick-message-service'
import SearchRepository from '../modules/search/repositories/implements/search-repository'
import type ISearchRepository from '../modules/search/repositories/interfaces/search-repository'
import SearchService from '../modules/search/services/implements/search-service'
import type ISearchService from '../modules/search/services/interfaces/search-service'
import SettingsService from '../modules/settings/services/implements/settings-service'
import type ISettingsService from '../modules/settings/services/interfaces/settings-service'
import StickerRepository from '../modules/stickers/repositories/implements/sticker-repository'
import type IStickerRepository from '../modules/stickers/repositories/interfaces/sticker-repository'
import StickerService from '../modules/stickers/services/implements/sticker-service'
import type IStickerService from '../modules/stickers/services/interfaces/sticker-service'
import TodoRepository from '../modules/todos/repositories/implements/todo-repository'
import type ITodoRepository from '../modules/todos/repositories/interfaces/todo-repository'
import TodoService from '../modules/todos/services/implements/todo-service'
import type ITodoService from '../modules/todos/services/interfaces/todo-service'
import { ZcaService } from '../third-party/zalo/zalo-client'
import { E2eeService } from '../third-party/signal/e2ee-service'
import { TOKENS } from './tokens'

export function createContainer(database: Database = openDatabase(config.dbPath)) {
  const container = new Container({ defaultScope: 'Singleton' })
  container.bind<Database>(TOKENS.Database).toConstantValue(database)
  container.bind(ZcaService).toSelf()
  container.bind(E2eeService).toSelf()
  container.bind<IAccountRepository>(TOKENS.AccountRepository).to(AccountRepository)
  container.bind<IBoardRepository>(TOKENS.BoardRepository).to(BoardRepository)
  container.bind<IBulkSendRepository>(TOKENS.BulkSendRepository).to(BulkSendRepository)
  container.bind<IContactRepository>(TOKENS.ContactRepository).to(ContactRepository)
  container.bind<IConversationRepository>(TOKENS.ConversationRepository).to(ConversationRepository)
  container.bind<IGroupRepository>(TOKENS.GroupRepository).to(GroupRepository)
  container.bind<IMessageRepository>(TOKENS.MessageRepository).to(MessageRepository)
  container.bind<IPinRepository>(TOKENS.PinRepository).to(PinRepository)
  container.bind<ISearchRepository>(TOKENS.SearchRepository).to(SearchRepository)
  container.bind<IStickerRepository>(TOKENS.StickerRepository).to(StickerRepository)
  container.bind<ITodoRepository>(TOKENS.TodoRepository).to(TodoRepository)
  container.bind<ISettingsService>(TOKENS.SettingsService).to(SettingsService)
  container.bind<IQuickMessageService>(TOKENS.QuickMessageService).to(QuickMessageService)
  container.bind<IAutoReplyService>(TOKENS.AutoReplyService).to(AutoReplyService)
  container.bind<ITodoService>(TOKENS.TodoService).to(TodoService)
  container.bind<IAccountService>(TOKENS.AccountService).to(AccountService)
  container.bind<IContactService>(TOKENS.ContactService).to(ContactService)
  container.bind<IMessageService>(TOKENS.MessageService).to(MessageService)
  container.bind<IStickerService>(TOKENS.StickerService).to(StickerService)
  container.bind<IConversationService>(TOKENS.ConversationService).to(ConversationService)
  container.bind<IPinService>(TOKENS.PinService).to(PinService)
  container.bind<ISearchService>(TOKENS.SearchService).to(SearchService)
  container.bind<IGroupService>(TOKENS.GroupService).to(GroupService)
  container.bind<IBoardService>(TOKENS.BoardService).to(BoardService)
  container.bind<IBulkSendService>(TOKENS.BulkSendService).to(BulkSendService)
  return container
}
