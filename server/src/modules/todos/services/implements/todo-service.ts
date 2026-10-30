import { inject, injectable } from 'inversify'
import { HTTPException } from 'hono/http-exception'
import { TodoStatus, ZaloApiError, type API, type Message } from '@hwqnq/zca-js'
import { broadcast } from '../../../../core'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import { parseBig, zaloGet, zaloPost } from '../../../../third-party/zalo/post'
import type { Todo } from '../../dtos/responses/todo.response'
import type IMessageService from '../../../messages/services/interfaces/message-service'
import type { CreateTodoRequest } from '../../dtos/requests/todo.request'
import { TOKENS } from '../../../../di/tokens'
import type ITodoRepository from '../../repositories/interfaces/todo-repository'
import type ITodoService from '../interfaces/todo-service'

// PC's MAX_TODO_CONTENT; TODO_DATE_TYPE NO_DATE / custom; CREATE_TODO_SRC MSG_MENU / CHATBAR_ICON; MSG_TEXT
const MAX_CONTENT = 2000
const NO_DATE = 0
const CUSTOM_DATE = 5
const FROM_MESSAGE = 2
const FROM_CHATBAR = 5
const MSG_TEXT = 1
const TODO_MESSAGE = 'chat.todo'
// zca's message types as PC's numeric ones (zca's getClientMessageType, not exported)
const CLIENT_TYPE: Record<string, number> = {
  webchat: 1,
  'chat.voice': 31,
  'chat.photo': 32,
  'chat.sticker': 36,
  'chat.doodle': 37,
  'chat.recommended': 38,
  'chat.link': 38,
  'chat.location.new': 43,
  'chat.video.msg': 44,
  'share.file': 46,
  'chat.gif': 49,
}
// verify pages until updated and deleted both come back empty; capped so a reply that never ends can't loop forever
const MAX_PAGES = 50
// zca's send reply has no clientId: the listener echo of our own message (selfListen) stores it
const ECHO_TRIES = 15
const ECHO_WAIT = 200

const NOT_EXIST = 'Công việc đã bị xoá hay không còn khả dụng'
// PC's toasts per Zalo code (STR_TODO_TOAST_*, STR_TODO_NOT_EXIST_TASK)
const CREATE_ERRORS: Record<number, string> = { 112: 'Có lỗi xảy ra khi tạo công việc', 166: 'Tạo công việc không thành công vì bạn không thể giao việc cho một vài thành viên' }
const STATUS_ERRORS: Record<number, string> = { 166: 'Bạn không thể thay đổi trạng thái vì công việc đã được giao cho người khác', 212: NOT_EXIST }
const ERRORS: Record<number, string> = { 212: NOT_EXIST }
const SEND_FAILED = 'Có lỗi xảy ra khi tạo công việc vì không thể gửi tin nhắn'

const explain = (table: Record<number, string>) => (e: unknown): never => {
  const text = e instanceof ZaloApiError && e.code != null ? table[e.code] : undefined
  throw text ? new HTTPException(400, { message: text }) : e
}
// PC's task_setting defaults to enable_feature 0: To-Do stays off unless Zalo turns it on for the account
const enabled = (api: API) => api.getContext().settings?.features?.task_setting?.enable_feature === 1

// people come as ids or { uid | userId | id, status }, the lists as JSON strings at times (PC's classifyTodoItem)
type Ref = string | number | { uid?: string; userId?: string; id?: string; status?: number }
type Extra = { toUid?: string | number; isGroup?: boolean; msgId?: string | number }
type RawTodo = {
  id: string | number
  creator: string | number
  assignees?: Ref[] | string
  watchers?: Ref[] | string
  content?: string
  description?: string
  dueDate?: number
  status?: number
  createTime?: number
  updateTime?: number
  dingTimes?: number
  extra?: Extra | string
}
type Verify = { scrollId?: string; updated?: RawTodo[]; deleted?: (string | number | { id: string | number; ts: number })[] }

const refs = (v: Ref[] | string | undefined) => (parseBig<Ref[] | null>(v ?? []) ?? []).filter((r) => r != null)
const idOf = (r: Ref) => String(typeof r === 'object' ? (r.uid ?? r.userId ?? r.id) : r)

// Zalo PC's To-Do ("Công việc"): personal-board todos assigned in a conversation, each anchored on a message there.
// Changes from anyone, any device, arrive as "chat.todo" messages (todo.create / update / delete ...) and go out on
// /events as "todos".
@injectable()
export default class TodoService implements ITodoService {
  constructor(
    @inject(TOKENS.TodoRepository) private todos: ITodoRepository,
    @inject(ZcaService) private zca: ZcaService,
    @inject(TOKENS.MessageService) private messages: IMessageService,
  ) {
    const changed = (accountId: string, ms: Message[]) => ms.some((m) => m.data.msgType === TODO_MESSAGE) && broadcast({ type: 'todos', accountId })
    zca.on('message', (accountId, m) => changed(accountId, [m]))
    zca.on('old_messages', changed)
  }

  // PC's lists keep todos this account created, is assigned or watches. Its status: its own assignee entry's, where
  // "Chưa nhận" counts as "Đã nhận" for its own creator; otherwise the todo's.
  async list(accountId: string): Promise<{ enabled: boolean; todos: Todo[] }> {
    const api = this.zca.get(accountId)
    if (!enabled(api)) return { enabled: false, todos: [] }
    const todos = (await this.verify(api)).flatMap((t) => {
      const creator = String(t.creator)
      const mine = creator === accountId
      const assignees = refs(t.assignees).map((r) => {
        const status = (typeof r === 'object' ? r.status : undefined) ?? t.status ?? TodoStatus.WaitingForResponse
        const userId = idOf(r)
        return { userId, status: userId === accountId && mine && status === TodoStatus.WaitingForResponse ? TodoStatus.InProcess : status }
      })
      const watchers = refs(t.watchers).map(idOf)
      const me = assignees.find((a) => a.userId === accountId)
      if (!mine && !me && !watchers.includes(accountId)) return []
      const extra = parseBig<Extra | null>(t.extra ?? {}) ?? {}
      // a group todo lives in its group; a 1-1 one with the other side
      const isGroup = !!extra.isGroup
      const threadId = isGroup || mine ? String(extra.toUid ?? '') : creator
      return [{ t, creator, assignees, watchers, status: me?.status ?? t.status ?? TodoStatus.WaitingForResponse, isGroup, threadId, msgId: extra.msgId ? String(extra.msgId) : null }]
    })
    const people = this.names(accountId, 'user', todos.flatMap((t) => [t.creator, ...t.assignees.map((a) => a.userId), ...(t.isGroup ? [] : [t.threadId])]))
    const groups = this.names(accountId, 'groups', todos.filter((t) => t.isGroup).map((t) => t.threadId))
    const person = (id: string) => people.get(id) ?? { userId: id, name: id, avatar: '' }
    return {
      enabled: true,
      todos: todos
        .map(({ t, creator, assignees, watchers, status, isGroup, threadId, msgId }) => {
          const { name, avatar } = (isGroup ? groups.get(threadId) : people.get(threadId)) ?? { name: threadId, avatar: '' }
          return {
            id: String(t.id),
            title: t.description ?? '',
            content: t.content ?? '',
            creator: person(creator),
            assignees: assignees.map((a) => ({ ...person(a.userId), status: a.status })),
            watchers,
            dueDate: t.dueDate && t.dueDate > 0 ? t.dueDate : -1,
            status,
            createTime: t.createTime ?? 0,
            updateTime: t.updateTime ?? 0,
            dingTimes: t.dingTimes ?? 0,
            thread: { threadId, isGroup, name, avatar },
            msgId,
          }
        })
        .sort((a, b) => b.updateTime - a.updateTime),
    }
  }

  // PC never makes a todo without an anchor message: from the editor the content goes to the thread as a text
  // first, from a message ("Giao việc") that message is the anchor. Status starts "Đã nhận" when this account picked
  // itself; nobody picked gives it to this account, still "Chưa nhận" as PC sends it.
  async create(accountId: string, r: CreateTodoRequest) {
    const api = this.zca.get(accountId)
    if (!enabled(api)) throw new HTTPException(403, { message: 'Zalo chưa bật To-Do cho tài khoản này' })
    const content = r.content.length > MAX_CONTENT ? `${r.content.slice(0, MAX_CONTENT - 3)}...` : r.content
    const anchor = r.msgId ? this.anchor(accountId, r.msgId) : await this.send(accountId, r.threadId, content)
    const todo = await zaloPost<{ id: string | number }>(api, 'boards', '/api/board/personal/todo/create', {
      assignees: JSON.stringify(r.assignees.length ? r.assignees : [accountId]),
      dueDate: r.dueDate,
      content,
      description: r.title,
      extra: JSON.stringify({ toUid: r.threadId, isGroup: r.isGroup, ...anchor }),
      dateDefaultType: r.dueDate > 0 ? CUSTOM_DATE : NO_DATE,
      status: r.assignees.includes(accountId) ? TodoStatus.InProcess : TodoStatus.WaitingForResponse,
      watchers: JSON.stringify([]),
      schedule: null,
      src: r.msgId ? FROM_MESSAGE : FROM_CHATBAR,
      imei: api.getContext().imei,
    }).catch(explain(CREATE_ERRORS))
    broadcast({ type: 'todos', accountId })
    return { id: String(todo.id) }
  }

  // "Nhận việc" (-1 → 0), "Hoàn thành" / "Kết thúc" (→ 1), "Mở lại" / "Giao lại" (1 → 0)
  async setStatus(accountId: string, id: string, status: TodoStatus) {
    await this.zca.get(accountId).updateTodoStatus(id, status).catch(explain(STATUS_ERRORS))
    broadcast({ type: 'todos', accountId })
  }

  // "Xoá công việc" (creator)
  async remove(accountId: string, id: string) {
    await this.zca.get(accountId).deleteTodo(id).catch(explain(ERRORS))
    broadcast({ type: 'todos', accountId })
  }

  // "Nhắc nhở": the creator dings the assignees (their dingTimes go up)
  async remind(accountId: string, id: string) {
    await this.zca.get(accountId).remindTodo([id]).catch(explain(ERRORS))
    broadcast({ type: 'todos', accountId })
  }

  // PC's verify from scratch: pages on scrollId; a deletion newer than the todo's last update drops it.
  // zca's getTodoChanges JSON.parses the reply, which would corrupt 19-digit msgIds in extra.
  // ponytail: every list fetches everything; keep PC's local todo table synced from lastUpdatedTime if lists get long
  private async verify(api: API) {
    const todos = new Map<string, RawTodo>()
    const deleted: NonNullable<Verify['deleted']> = []
    let scrollId = ''
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await zaloGet<Verify>(api, 'boards', '/api/board/personal/todo/verify', { scrollId, lastUpdatedTime: 0, imei: api.getContext().imei })
      if (!r.updated?.length && !r.deleted?.length) break
      for (const t of r.updated ?? []) todos.set(String(t.id), t)
      deleted.push(...(r.deleted ?? []))
      scrollId = r.scrollId || scrollId
    }
    for (const d of deleted) {
      const id = String(typeof d === 'object' ? d.id : d)
      if (typeof d !== 'object' || (todos.get(id)?.updateTime ?? 0) < d.ts) todos.delete(id)
    }
    return [...todos.values()]
  }

  // "Giao việc" on a message: PC's extra from it (its text is the content), without the message itself
  private anchor(accountId: string, msgId: string) {
    const m = this.todos.message(accountId, msgId)
    if (!m) throw new HTTPException(404, { message: 'Không tìm thấy tin nhắn' })
    return { msgId, cliMsgId: m.cliMsgId ?? '0', msgType: CLIENT_TYPE[m.msgType] ?? MSG_TEXT, mention: m.mentions ? JSON.parse(m.mentions) : [], ownerMsgUId: m.fromUid ?? accountId }
  }

  // the editor's content sent as a plain text to the thread, then anchored on
  private async send(accountId: string, threadId: string, text: string) {
    const { msgId } = await this.messages.sendText(accountId, threadId, { text }).catch((e) => {
      throw e instanceof ZaloApiError ? new HTTPException(400, { message: SEND_FAILED }) : e
    })
    if (!msgId) throw new HTTPException(400, { message: SEND_FAILED })
    return { msgId, cliMsgId: await this.cliMsgId(accountId, msgId), msgType: MSG_TEXT, mention: [], ownerMsgUId: accountId, message: text }
  }

  // ponytail: polls for the echo up to 3 s, then "0"; hook the send itself if Zalo needs the real clientId
  private async cliMsgId(accountId: string, msgId: string) {
    for (let i = 0; i < ECHO_TRIES; i++) {
      const row = this.todos.cliMsgId(accountId, msgId)
      if (row?.cliMsgId) return row.cliMsgId
      await Bun.sleep(ECHO_WAIT)
    }
    return '0'
  }

  // local names (alias first) and avatars of users or groups
  private names(accountId: string, table: 'user' | 'groups', ids: string[]) {
    return new Map(this.todos.names(accountId, table, ids).map((p) => [p.userId, p]))
  }
}
