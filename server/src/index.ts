import { Hono } from 'hono'
import { websocket } from 'hono/bun'
import { cors } from 'hono/cors'
import { config } from './config'
import { authMiddleware, eventsWebSocket, useExceptionHandler } from './core'
import { createContainer } from './di/dependency-injection'
import { TOKENS } from './di/tokens'
import { accountRoutes } from './modules/accounts'
import type IAccountService from './modules/accounts/services/interfaces/account-service'
import { autoReplyRoutes } from './modules/auto-replies'
import type IAutoReplyService from './modules/auto-replies/services/interfaces/auto-reply-service'
import { boardRoutes } from './modules/boards'
import type IBoardService from './modules/boards/services/interfaces/board-service'
import { bulkSendRoutes, bulkTemplateRoutes } from './modules/bulk-sends'
import type IBulkSendService from './modules/bulk-sends/services/interfaces/bulk-send-service'
import { contactRoutes } from './modules/contacts'
import type IContactService from './modules/contacts/services/interfaces/contact-service'
import { conversationRoutes } from './modules/conversations'
import type IConversationService from './modules/conversations/services/interfaces/conversation-service'
import { groupRoutes } from './modules/groups'
import type IGroupService from './modules/groups/services/interfaces/group-service'
import { messageRoutes } from './modules/messages'
import type IMessageService from './modules/messages/services/interfaces/message-service'
import { pinRoutes } from './modules/pins'
import type IPinService from './modules/pins/services/interfaces/pin-service'
import { quickMessageRoutes } from './modules/quick-messages'
import type IQuickMessageService from './modules/quick-messages/services/interfaces/quick-message-service'
import { searchRoutes } from './modules/search'
import type ISearchService from './modules/search/services/interfaces/search-service'
import { settingsRoutes } from './modules/settings'
import type ISettingsService from './modules/settings/services/interfaces/settings-service'
import { stickerRoutes } from './modules/stickers'
import type IStickerService from './modules/stickers/services/interfaces/sticker-service'
import { todoRoutes } from './modules/todos'
import type ITodoService from './modules/todos/services/interfaces/todo-service'
import { Sync2Service } from './third-party/sync2/sync2-service'

// resolve order = order services subscribe to Zalo events
const container = createContainer()
const accounts = container.get<IAccountService>(TOKENS.AccountService)
const contacts = container.get<IContactService>(TOKENS.ContactService)
const messages = container.get<IMessageService>(TOKENS.MessageService)
const stickers = container.get<IStickerService>(TOKENS.StickerService)
const conversations = container.get<IConversationService>(TOKENS.ConversationService)
const pins = container.get<IPinService>(TOKENS.PinService)
const search = container.get<ISearchService>(TOKENS.SearchService)
const groups = container.get<IGroupService>(TOKENS.GroupService)
const boards = container.get<IBoardService>(TOKENS.BoardService)
const settings = container.get<ISettingsService>(TOKENS.SettingsService)
const quickMessages = container.get<IQuickMessageService>(TOKENS.QuickMessageService)
const autoReplies = container.get<IAutoReplyService>(TOKENS.AutoReplyService)
const todos = container.get<ITodoService>(TOKENS.TodoService)
const bulkSends = container.get<IBulkSendService>(TOKENS.BulkSendService)
const sync = container.get(Sync2Service)

const app = new Hono()

app.use(cors())
app.use(authMiddleware)
useExceptionHandler(app)

app.get('/events', eventsWebSocket)
app.route('/accounts', accountRoutes(accounts))
app.route('/', bulkTemplateRoutes(bulkSends))
app.route('/accounts/:accountId', contactRoutes(contacts))
app.route('/accounts/:accountId', messageRoutes(messages, sync))
app.route('/accounts/:accountId', stickerRoutes(stickers))
app.route('/accounts/:accountId', conversationRoutes(conversations, messages))
app.route('/accounts/:accountId', pinRoutes(pins))
app.route('/accounts/:accountId', searchRoutes(search, conversations))
app.route('/accounts/:accountId', groupRoutes(groups))
app.route('/accounts/:accountId', boardRoutes(boards))
app.route('/accounts/:accountId', settingsRoutes(settings))
app.route('/accounts/:accountId', quickMessageRoutes(quickMessages))
app.route('/accounts/:accountId', autoReplyRoutes(autoReplies))
app.route('/accounts/:accountId', todoRoutes(todos))
app.route('/accounts/:accountId', bulkSendRoutes(bulkSends))

// idleTimeout (s): turning E2EE on waits up to 10 s for the peer's ack after its own socket round trips; Bun's default 10 s cuts it
const server = Bun.serve({ hostname: '127.0.0.1', port: config.port, fetch: app.fetch, websocket, idleTimeout: 60 })

console.log('READY ' + JSON.stringify({ port: server.port, token: config.token }))

void accounts.restore()

if (!process.stdin.isTTY) process.stdin.on('end', () => process.exit(0)).resume()
