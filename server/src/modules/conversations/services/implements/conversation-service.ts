import { inject, injectable } from 'inversify'
import { HTTPException } from 'hono/http-exception'
import { MuteAction, MuteDuration, type API, type ChatTTL, type LabelData } from '@hwqnq/zca-js'
import { broadcast } from '../../../../core'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import { controlData, type Control } from '../../../../third-party/zalo/controls'
import { parseBig, zaloGet, zaloPost } from '../../../../third-party/zalo/post'
import type { AutoDeleteRequest, LabelRequest, MuteRequest } from '../../dtos/requests/conversation.request'
import { TOKENS } from '../../../../di/tokens'
import type { ConversationSettings } from '../../dtos/responses/conversation.response'
import type IConversationRepository from '../../repositories/interfaces/conversation-repository'
import type IConversationService from '../interfaces/conversation-service'
import { MAX_UNREAD_MARKS, MAX_LABELS, BAD_PIN } from '../../constants/conversation.constant'
import type { State } from '../../models/conversation.model'
import { next8AM, bare, type, md5, labelKey } from '../../helpers/conversation.helper'

// Zalo PC's per-conversation settings: "Ghim hội thoại", "Tắt thông báo", "Tin nhắn tự xóa", "Đánh dấu chưa đọc",
// "Ưu tiên" / "Khác", "Phân loại" and "Ẩn trò chuyện"; loaded when an account connects and kept in memory, changes
// made elsewhere arrive as websocket controls.
@injectable()
export default class ConversationService implements IConversationService {
  private states = new Map<string, State>()

  constructor(
    @inject(ZcaService) private zca: ZcaService,
    @inject(TOKENS.ConversationRepository) private conversations: IConversationRepository,
  ) {
    zca.on('attached', (id) => void this.load(id).catch((e) => console.error(`[${id}] conversation settings`, e)))
    zca.on('control', (id, c) => this.onControl(id, c))
  }

  settings(accountId: string): ConversationSettings {
    const s = this.state(accountId)
    const now = Date.now()
    return {
      pinned: [...s.pinned],
      muted: Object.fromEntries([...s.muted].filter(([, until]) => until === -1 || until > now)),
      ttl: Object.fromEntries(s.ttl),
      unread: [...s.unread],
      archived: [...s.archived],
      labels: s.labels.map((l) => ({ id: l.id, text: l.text, color: l.color, emoji: l.emoji, conversations: (l.conversations ?? []).map(bare) })),
      hidden: [...s.hidden],
      hasPin: !!s.pin,
    }
  }

  // PC puts the thread's ttl on every message it sends there
  ttl(accountId: string, threadId: string) {
    return this.state(accountId).ttl.get(threadId) ?? 0
  }

  hidden(accountId: string) {
    return this.state(accountId).hidden
  }

  // the PIN opens every hidden conversation from the search box, as on PC
  pinMatches(accountId: string, pin: string) {
    const { pin: hash } = this.state(accountId)
    return !!hash && pin.length === 4 && md5(pin) === hash
  }

  async setPinned(accountId: string, threadId: string, isGroup: boolean, pinned: boolean) {
    await this.zca.get(accountId).setPinnedConversations(pinned, threadId, type(isGroup))
    const state = this.state(accountId)
    if (pinned) state.pinned.add(threadId)
    else state.pinned.delete(threadId)
    this.changed(accountId)
  }

  async setMute(accountId: string, threadId: string, { isGroup, duration }: MuteRequest) {
    await this.zca.get(accountId).setMute(duration === null ? { action: MuteAction.UNMUTE } : { duration: duration === 'until8AM' ? MuteDuration.UNTIL_8AM : duration }, threadId, type(isGroup))
    const { muted } = this.state(accountId)
    if (duration === null) muted.delete(threadId)
    else muted.set(threadId, duration === -1 ? -1 : duration === 'until8AM' ? next8AM() : Date.now() + duration * 1000)
    this.changed(accountId)
  }

  // zca's ChatTTL lacks PC's 1 hour; 0 turns it off
  async setAutoDelete(accountId: string, threadId: string, { isGroup, ttl }: AutoDeleteRequest) {
    await this.zca.get(accountId).updateAutoDeleteChat(ttl as ChatTTL, threadId, type(isGroup))
    const state = this.state(accountId)
    if (ttl) state.ttl.set(threadId, ttl)
    else state.ttl.delete(threadId)
    this.changed(accountId)
  }

  // "Đánh dấu chưa đọc" / "Đánh dấu đã đọc". PC marks with the last message's ids (-1 for an empty thread); zca sends
  // made-up ones, so the add is built here.
  async setUnread(accountId: string, threadId: string, isGroup: boolean, unread: boolean) {
    const state = this.state(accountId)
    if (unread === state.unread.has(threadId)) return
    const api = this.zca.get(accountId)
    if (!unread) await api.removeUnreadMark(threadId, type(isGroup))
    else {
      if (state.unread.size >= MAX_UNREAD_MARKS) throw new HTTPException(400, { message: 'Số lượng hội thoại có thể đánh dấu chưa đọc đã vượt giới hạn' })
      const last = this.conversations.lastMessage(accountId, threadId)
      const mark = { id: threadId, cliMsgId: last?.cliMsgId ?? '-1', fromUid: !last ? '-1' : last.fromUid === accountId ? '0' : last.fromUid, ts: Date.now() }
      await zaloPost(api, 'conversation', '/api/conv/addUnreadMark', {
        param: JSON.stringify({ convsGroup: isGroup ? [mark] : [], convsUser: isGroup ? [] : [mark], imei: api.getContext().imei }),
      }).catch((e) => {
        throw Number(e?.code) === 277 ? new HTTPException(400, { message: 'Số lượng hội thoại có thể đánh dấu chưa đọc đã vượt giới hạn' }) : e
      })
    }
    if (unread) state.unread.add(threadId)
    else state.unread.delete(threadId)
    this.changed(accountId)
  }

  // "Chuyển sang mục Khác" / "Chuyển sang mục Ưu tiên"
  async setArchived(accountId: string, threadId: string, isGroup: boolean, archived: boolean) {
    await this.zca.get(accountId).updateArchivedChatList(archived, { id: threadId, type: type(isGroup) })
    const state = this.state(accountId)
    if (archived) state.archived.add(threadId)
    else state.archived.delete(threadId)
    this.changed(accountId)
  }

  // A conversation sits in at most one label; null takes it out of its label
  setLabel(accountId: string, threadId: string, isGroup: boolean, labelId: number | null) {
    return this.saveLabels(accountId, (labels) => {
      const key = labelKey(threadId, isGroup)
      for (const l of labels) l.conversations = (l.conversations ?? []).filter((c) => bare(c) !== threadId)
      const label = labels.find((l) => l.id === labelId)
      if (labelId !== null && !label) throw new HTTPException(404, { message: 'Không tìm thấy phân loại' })
      label?.conversations.push(key)
    })
  }

  // "Thêm mới thẻ phân loại", "Đặt lại tên phân loại" / color, "Xoá phân loại này"
  createLabel(accountId: string, { text, color }: LabelRequest) {
    return this.saveLabels(accountId, (labels) => {
      if (labels.length >= MAX_LABELS) throw new HTTPException(400, { message: `Chỉ tạo được tối đa ${MAX_LABELS} phân loại` })
      this.checkName(labels, text)
      labels.push({ id: Math.max(0, ...labels.map((l) => l.id)) + 1, text, textKey: '', conversations: [], color, offset: labels.length, emoji: '', createTime: Date.now() })
    })
  }

  updateLabel(accountId: string, id: number, { text, color }: LabelRequest) {
    return this.saveLabels(accountId, (labels) => {
      const label = labels.find((l) => l.id === id)
      if (!label) throw new HTTPException(404, { message: 'Không tìm thấy phân loại' })
      this.checkName(labels.filter((l) => l !== label), text)
      Object.assign(label, { text, color, textKey: label.text === text ? label.textKey : '' })
    })
  }

  deleteLabel(accountId: string, id: number) {
    return this.saveLabels(accountId, (labels) => {
      const i = labels.findIndex((l) => l.id === id)
      if (i >= 0) labels.splice(i, 1)
    })
  }

  // "Ẩn trò chuyện": the first hide sets the PIN ("Đặt mã PIN"), later ones need it; showing again needs no PIN
  async setHidden(accountId: string, threadId: string, isGroup: boolean, hidden: boolean, pin?: string) {
    const state = this.state(accountId)
    const api = this.zca.get(accountId)
    if (hidden && !state.pin) {
      if (!pin || !/^\d{4}$/.test(pin)) throw new HTTPException(400, { message: 'Mã PIN gồm 4 chữ số' })
      await api.updateHiddenConversPin(pin)
      state.pin = md5(pin)
    } else if (hidden && !this.pinMatches(accountId, pin ?? '')) throw new HTTPException(403, { message: BAD_PIN })
    await api.setHiddenConversations(hidden, threadId, type(isGroup))
    if (hidden) state.hidden.add(threadId)
    else state.hidden.delete(threadId)
    this.changed(accountId)
  }

  verifyPin(accountId: string, pin: string) {
    if (!this.pinMatches(accountId, pin)) throw new HTTPException(403, { message: BAD_PIN })
  }

  // "Đổi mã PIN": the old one is checked here, as PC does on the client
  async changePin(accountId: string, oldPin: string, newPin: string) {
    this.verifyPin(accountId, oldPin)
    await this.zca.get(accountId).updateHiddenConversPin(newPin)
    this.state(accountId).pin = md5(newPin)
    this.changed(accountId)
  }

  // "Đặt lại mã PIN": the hidden conversations are dropped (PC deletes them locally); returns their ids
  async resetPin(accountId: string) {
    await this.zca.get(accountId).resetHiddenConversPin()
    const state = this.state(accountId)
    const ids = [...state.hidden]
    state.hidden.clear()
    state.pin = ''
    this.changed(accountId)
    return ids
  }

  // a deleted conversation loses its unread mark, as on PC
  forget(accountId: string, threadId: string) {
    if (this.state(accountId).unread.delete(threadId)) this.changed(accountId)
  }

  // PC's _processCtrlMessages for settings changed on another device (or, for ttl, by the other side / group owner)
  private onControl(accountId: string, c: Control) {
    const state = this.state(accountId)
    if (c.act_type === 'conv_settings' && c.act === 'update_ttl') {
      const d = controlData<{ threadId?: string | number; ttl?: number }>(c)
      if (d?.threadId == null) return
      if (d.ttl) state.ttl.set(bare(String(d.threadId)), Number(d.ttl))
      else state.ttl.delete(bare(String(d.threadId)))
    } else if (c.act_type === 'pinned_convers') {
      // action 1 pins, anything else unpins; ids are "u123" / "g456"
      const d = controlData<{ pinIds?: string[]; action?: number }>(c)
      for (const id of d?.pinIds ?? []) d.action === 1 ? state.pinned.add(bare(id)) : state.pinned.delete(bare(id))
    } else if (c.act_type === 'mute') {
      // set: duration in seconds from systemTime (seconds), -1 = until turned back on; muteType 1 = user (ids bare)
      const d = controlData<{ toId?: string | number; duration?: number; systemTime?: number }>(c)
      if (d?.toId == null) return
      const id = String(d.toId)
      const until = d.duration === -1 ? -1 : (Number(d.systemTime) + Number(d.duration)) * 1000
      if (c.act === 'set' && (until === -1 || until > Date.now())) state.muted.set(id, until)
      else if (c.act === 'unset') state.muted.delete(id)
      else return
    } else if (c.act_type === 'mark_unread') {
      // PC reads content.content here, not data: add carries marks, remove bare ids
      const d = parseBig<{ convsUser?: (string | { id: string })[]; convsGroup?: (string | { id: string })[] }>(c.content ?? c.data)
      for (const m of [...(d?.convsUser ?? []), ...(d?.convsGroup ?? [])]) {
        const id = String(typeof m === 'object' ? m.id : m)
        if (c.act === 'add') state.unread.add(id)
        else state.unread.delete(id)
      }
    } else if (c.act_type === 'hidden_chat') {
      const d = controlData<{ add_items?: { thread_id: string }[]; del_items?: { thread_id: string }[]; pin?: string }>(c)
      if (c.act === 'add_remove') {
        for (const i of d?.add_items ?? []) state.hidden.add(String(i.thread_id))
        for (const i of d?.del_items ?? []) state.hidden.delete(String(i.thread_id))
      } else if (c.act === 'change_pin') state.pin = d?.pin ?? ''
      else if (c.act === 'reset') (state.pin = '', state.hidden.clear())
      else return
    } else if (c.act_type === 'label_convers' || c.act_type === 'archived_chat') {
      // PC refetches both lists
      void (c.act_type === 'label_convers' ? this.loadLabels(accountId) : this.loadArchived(accountId)).then(() => this.changed(accountId)).catch((e) => console.error(`[${accountId}] ${c.act_type}`, e))
      return
    } else return
    this.changed(accountId)
  }

  private async load(accountId: string) {
    const api = this.zca.get(accountId)
    const [pins, mutes, autoDelete] = await Promise.all([api.getPinConversations(), api.getMute(), api.getAutoDeleteChat()])
    const muted = new Map<string, number>()
    for (const e of [...mutes.chatEntries, ...mutes.groupChatEntries]) {
      const start = e.startTime > 1e12 ? e.startTime : e.startTime * 1000
      muted.set(bare(String(e.id)), e.duration === -1 ? -1 : start + e.duration * 1000)
    }
    const state = this.state(accountId)
    state.pinned = new Set(pins.conversations.map(bare))
    state.muted = muted
    state.ttl = new Map(autoDelete.convers.filter((c) => c.ttl > 0).map((c) => [bare(String(c.destId)), c.ttl]))
    // features the server may keep off for this account: each loads on its own
    await Promise.all(
      [this.loadUnread(accountId, api), this.loadArchived(accountId), this.loadLabels(accountId), this.loadHidden(accountId, api)].map((p) =>
        p.catch((e) => console.error(`[${accountId}] conversation settings`, e)),
      ),
    )
    this.changed(accountId)
  }

  // ids are big numbers in these replies: read without zca's JSON.parse
  private async loadUnread(accountId: string, api: API) {
    const r = await zaloGet<{ data: unknown }>(api, 'conversation', '/api/conv/getUnreadMark', {})
    const d = parseBig<{ convsUser?: { id: string }[]; convsGroup?: { id: string }[] }>(r?.data)
    this.state(accountId).unread = new Set([...(d?.convsUser ?? []), ...(d?.convsGroup ?? [])].map((m) => String(m.id)))
  }

  private async loadArchived(accountId: string) {
    const api = this.zca.get(accountId)
    const r = await zaloGet<{ items?: (string | { id: string })[] }>(api, 'label', '/api/archivedchat/list', { version: 1, imei: api.getContext().imei })
    this.state(accountId).archived = new Set((r?.items ?? []).map((i) => bare(String(typeof i === 'object' ? i.id : i))))
  }

  private async loadLabels(accountId: string) {
    const api = this.zca.get(accountId)
    const r = await zaloGet<{ labelData: unknown; version: number }>(api, 'label', '/api/convlabel/get', { imei: api.getContext().imei })
    const state = this.state(accountId)
    state.labels = parseBig<LabelData[]>(r?.labelData) ?? []
    state.labelVersion = r?.version ?? 0
  }

  private async loadHidden(accountId: string, api: API) {
    const r = await zaloGet<{ pin?: string; threads?: { thread_id: string }[] }>(api, 'conversation', '/api/hiddenconvers/get-all', { imei: api.getContext().imei })
    const state = this.state(accountId)
    state.pin = r?.pin ?? ''
    state.hidden = new Set((r?.threads ?? []).map((t) => String(t.thread_id)))
  }

  // PC sends the whole list with its version; a stale version gets the list reloaded and the change applied again
  private async saveLabels(accountId: string, change: (labels: LabelData[]) => void, retry = true): Promise<void> {
    const state = this.state(accountId)
    const labels: LabelData[] = structuredClone(state.labels)
    change(labels)
    try {
      const r = await this.zca.get(accountId).updateLabels({ labelData: labels, version: state.labelVersion })
      state.labels = labels
      state.labelVersion = r.version ?? state.labelVersion + 1
    } catch (e) {
      if (!retry || e instanceof HTTPException) throw e
      await this.loadLabels(accountId)
      return this.saveLabels(accountId, change, false)
    }
    this.changed(accountId)
  }

  private checkName(labels: LabelData[], text: string) {
    if (labels.some((l) => l.text.trim().toLowerCase() === text.trim().toLowerCase())) throw new HTTPException(400, { message: 'Phân loại đã tồn tại' })
  }

  private changed(accountId: string) {
    broadcast({ type: 'conversations', accountId })
  }

  private state(accountId: string) {
    let state = this.states.get(accountId)
    if (!state)
      this.states.set(
        accountId,
        (state = { pinned: new Set(), muted: new Map(), ttl: new Map(), unread: new Set(), archived: new Set(), labels: [], labelVersion: 0, hidden: new Set(), pin: '' }),
      )
    return state
  }
}
