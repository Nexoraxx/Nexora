import { inject, injectable } from 'inversify'
import { HTTPException } from 'hono/http-exception'
import { FriendEventType, GroupEventType, type API, type FriendEvent, type GroupEvent } from '@hwqnq/zca-js'
import { broadcast } from '../../../../core'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import { zaloPost } from '../../../../third-party/zalo/post'
import type { PinRequest } from '../../dtos/requests/pin.request'
import { TOKENS } from '../../../../di/tokens'
import type { Pin } from '../../dtos/responses/pin.response'
import type IPinRepository from '../../repositories/interfaces/pin-repository'
import type IPinService from '../interfaces/pin-service'

// Zalo PC topic type of a pinned message (0 note, 1 link, 2 message, 3 poll, 4 reminder)
const MSG_TOPIC = 2
// Zalo PC: 1-1 pins are capped at 3; groups use pin/list's pinLimit, else group_topics.pin_limit 10
const FRIEND_PIN_LIMIT = 3
const GROUP_PIN_LIMIT = 10
// createGroupTopicv2's color when settings.group.topic_colors is empty
const TOPIC_COLOR = -16777216
// Zalo PC's msg_type codes inside a pinned message's params, and its emoji per type (getUnicodeCorrMSGType)
const CLI_TYPE: Record<string, number> = {
  webchat: 1,
  'chat.voice': 31,
  'chat.photo': 32,
  'chat.sticker': 36,
  'chat.doodle': 37,
  'chat.recommended': 38,
  'chat.location.new': 43,
  'chat.video.msg': 44,
  'share.file': 46,
  'chat.gif': 49,
}
const EMOJI: Record<string, string> = { webchat: '📌', 'chat.photo': '🌄', 'chat.gif': '🌄', 'chat.doodle': '🌄', 'chat.video.msg': '🎥', 'chat.location.new': '📍' }
const PIN_EVENTS = new Set([GroupEventType.NEW_PIN_TOPIC, GroupEventType.UPDATE_PIN_TOPIC, GroupEventType.UNPIN_TOPIC, GroupEventType.REORDER_PIN_TOPIC])

type Topic = { id?: string | number; type?: number; params?: unknown; creatorId?: string; createTime?: number }
type Board = { topics: Topic[]; version: number; limit: number }

const json = (v: unknown) => {
  try {
    return (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>
  } catch {
    return {}
  }
}
const str = (v: unknown) => (v == null || v === '' ? null : String(v))

// Zalo PC "Ghim tin nhắn": the pin bar on top of a conversation. Groups keep pins on the group board (pin/list,
// topic/createv2 with type 2, multi_unpin); 1-1 conversations on the friend board (friendboard/*), keyed by the friend's uid.
@injectable()
export default class PinService implements IPinService {
  constructor(
    @inject(TOKENS.PinRepository) private pins: IPinRepository,
    @inject(ZcaService) private zca: ZcaService,
  ) {
    // pins changed by anyone, on any device
    zca.on('group_event', (accountId, e: GroupEvent) => PIN_EVENTS.has(e.type) && broadcast({ type: 'pins', accountId, threadId: e.threadId }))
    zca.on('friend_event', (accountId, e: FriendEvent) => {
      if (e.type === FriendEventType.PIN_CREATE || e.type === FriendEventType.PIN_UNPIN) broadcast({ type: 'pins', accountId, threadId: e.threadId })
    })
  }

  async list(accountId: string, threadId: string) {
    const { topics, limit } = await this.board(this.zca.get(accountId), threadId, this.pins.isGroup(accountId, threadId))
    return { pins: topics.map(toPin), limit }
  }

  // `replace`: the pin to drop first when the list is full ("Ghim cũ dưới đây sẽ được bỏ để cập nhật nội dung mới.")
  async pin(accountId: string, threadId: string, { msgId, replace }: PinRequest) {
    const m = this.pins.message(accountId, msgId)
    if (!m || m.toUid !== threadId) throw new HTTPException(404, { message: 'Không tìm thấy tin nhắn' })
    if (m.fromUid === null || !(m.msgType in CLI_TYPE)) throw new HTTPException(400, { message: 'Không ghim được tin nhắn này' })
    const isGroup = this.pins.isGroup(accountId, threadId)
    if (isGroup && !this.canPinInGroup(accountId, threadId)) throw new HTTPException(403, { message: 'Chỉ trưởng/phó nhóm được phép ghim tin nhắn' })
    const api = this.zca.get(accountId)
    if (replace) await this.unpin(accountId, threadId, replace.topicId, replace.topicType)
    const content = json(m.message)
    const params = {
      client_msg_id: m.cliMsgId ?? '0',
      global_msg_id: m.msgId,
      senderUid: m.fromUid,
      senderName: m.dName ?? this.pins.name(accountId, m.fromUid) ?? '',
      // text, caption, file name or link title
      title: m.msgText ?? '',
      msg_type: CLI_TYPE[m.msgType],
      ...(typeof content.thumb === 'string' && content.thumb ? { thumb: content.thumb } : {}),
      ...(typeof content.href === 'string' && content.href ? { href: content.href } : {}),
    }
    const emoji = EMOJI[m.msgType] ?? (m.msgType === 'chat.recommended' && content.action === 'recommened.link' ? '🔗' : '📎')
    if (isGroup) await this.createGroupTopic(api, threadId, params, emoji)
    else {
      const { version } = await this.board(api, threadId, false)
      await api.createFriendBoardTopic(threadId, { type: MSG_TOPIC, params, emoji }, version)
    }
    broadcast({ type: 'pins', accountId, threadId })
  }

  async unpin(accountId: string, threadId: string, topicId: string, topicType: number) {
    const api = this.zca.get(accountId)
    const isGroup = this.pins.isGroup(accountId, threadId)
    const { version } = await this.board(api, threadId, isGroup)
    if (isGroup) await api.unpinTopics(threadId, [{ topicId, topicType }], version)
    else await api.unpinFriendBoardTopics(threadId, [{ topicId, topicType }], version)
    broadcast({ type: 'pins', accountId, threadId })
  }

  private async board(api: API, threadId: string, isGroup: boolean): Promise<Board> {
    if (isGroup) {
      const r = await api.getPinnedTopics(threadId)
      return { topics: (r.items ?? []) as Topic[], version: r.boardVersion ?? 0, limit: r.pinLimit || GROUP_PIN_LIMIT }
    }
    const r = await api.getFriendBoardList(threadId)
    return { topics: (r.data ?? []) as Topic[], version: r.version ?? 0, limit: FRIEND_PIN_LIMIT }
  }

  // zca has no message pin for groups (createNote is type 0 only): PC's createGroupTopicv2
  private createGroupTopic(api: API, groupId: string, params: Record<string, unknown>, emoji: string) {
    return zaloPost(api, 'group_board', '/api/board/topic/createv2', {
      grid: groupId,
      type: MSG_TOPIC,
      color: TOPIC_COLOR,
      emoji,
      startTime: -1,
      duration: -1,
      params: JSON.stringify(params),
      repeat: 0,
      imei: api.getContext().imei,
      pinAct: 1,
    })
  }

  // PC's hasPinMessagePermissionInGroup: owner, deputies, or everyone unless setting.setTopicOnly
  private canPinInGroup(accountId: string, groupId: string) {
    const g = this.pins.groupSetting(accountId, groupId)
    if (!json(g?.setting).setTopicOnly) return true
    return g?.creatorId === accountId || (JSON.parse(g?.adminIds ?? '[]') as string[]).includes(accountId)
  }
}

// params is a JSON string whose `extra` may itself be JSON (PC parses both)
function toPin(t: Topic): Pin {
  const p = json(t.params)
  return {
    topicId: String(t.id),
    topicType: Number(t.type),
    msgId: str(p.global_msg_id),
    cliMsgId: str(p.client_msg_id),
    senderUid: str(p.senderUid),
    senderName: str(p.senderName),
    title: String(p.title ?? ''),
    msgType: p.msg_type == null ? null : Number(p.msg_type),
    thumb: str(p.thumb),
    createTime: t.createTime ?? null,
  }
}
