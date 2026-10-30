import { inject, injectable } from 'inversify'
import { HTTPException } from 'hono/http-exception'
import {
  GroupEventType,
  GroupMessage,
  ThreadType,
  UserMessage,
  type API,
  type DeliveredMessage,
  type GroupEvent,
  type Message,
  type Reaction,
  type Reactions,
  type SeenMessage,
  type SendDeliveredEventMessageParams,
  type Style,
  type TGroupEventBase,
  type TMessage,
  type Typing,
  type Undo,
  ZaloApiError,
} from '@hwqnq/zca-js'
import type { Database } from '../../../../dbs/sqlite'
import { broadcast } from '../../../../core'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import { nextClientId, zaloPost } from '../../../../third-party/zalo/post'
import type IContactService from '../../../contacts/services/interfaces/contact-service'
import type IConversationService from '../../../conversations/services/interfaces/conversation-service'
import type { Gif, SearchRequest, SendAttachmentsRequest, SendCardsRequest, SendLinkRequest, SendMessageRequest, SendStickerRequest } from '../../dtos/requests/message.request'
import type { LinkPreview, MessageInfo, MessageRow, ReactionCount, Thread, MediaKind } from '../../dtos/responses/message.response'
import { GROUP_NOTI, GROUP_STATE_EVENTS, groupEventText } from './group-event'
import { TOKENS } from '../../../../di/tokens'
import type IMessageRepository from '../../repositories/interfaces/message-repository'
import { E2EE, E2EE_CMDS, type Row, type Saved, type StoredMessage } from '../../repositories/interfaces/message-repository'
import type IMessageService from '../interfaces/message-service'
import { E2eeService } from '../../../../third-party/signal/e2ee-service'
import { E2EE_STATUS, type Decrypted, type E2eeMessage } from '../../../../third-party/signal/e2ee-message-receiver'

// events that may take this account out of a group
const OUT_EVENTS = new Set<GroupEventType>([GroupEventType.LEAVE, GroupEventType.REMOVE_MEMBER, GroupEventType.BLOCK_MEMBER])

// sendDeliveredEvent / sendSeenEvent accept at most 50 messages
const RECEIPT_BATCH = 50
const LAST_SEEN_BATCH = 50
// Zalo PC doesn't repeat a group cloud request with the same params within this window (cloud.preventCloudLoadSameParams)
const CLOUD_SAME_PARAMS_MS = 10_000
// Zalo PC: settings.chat.time_undomsg (seconds) when the server sends it, else 5 minutes; max_msg_per_recall
const RECALL_SECONDS = 300
const MAX_RECALL = 50
// Zalo PC's max_member_group_show_seen: bigger groups get no "Đã xem" / "Đã nhận" lists
const SEEN_MAX_MEMBERS = 20
// a jump to a found message loads everything from it to the newest, up to this many
const JUMP_LIMIT = 1000
// Zalo PC's msgType codes for /api/message/forward and /api/group/forward (MSGTYPE_FORWARD_*)
const FORWARD_TYPE: Record<string, number> = { 'share.file': 1, 'chat.photo': 2, 'chat.doodle': 2, 'chat.voice': 3, 'chat.gif': 4, 'chat.video.msg': 5, 'chat.location.new': 7 }
const FORWARD_CONTACT = 6
// Zalo PC "Gửi danh thiếp": at most 9 cards at once
const MAX_CARDS = 9
// Zalo PC link preview: max_url_character, title / desc cut at 80 / 200
const MAX_URL = 500
const LINK_TITLE = 80
const LINK_DESC = 200
// Zalo PC GIF panel: first trending page 50, then pages of 10 (search too); src 1 = sent from the chat bar
const GIF_FIRST_PAGE = 50
const GIF_PAGE = 10
const GIF_SRC_CHAT = 1
// ponytail: only text is end-to-end encrypted so far; replies, media, stickers, links, cards, forwards are refused there
const E2EE_UNSUPPORTED = 'Nexora chưa hỗ trợ gửi loại tin nhắn này trong trò chuyện mã hóa đầu cuối'
// this account's devices in PC's MISS_BUNDLE_KEY_* messages, in PC's order
const MY_DEVICE_NAMES: [number, string][] = [
  [0, 'Zalo trên điện thoại'],
  [2, 'Zalo PC'],
  [1, 'Zalo trên trình duyệt máy tính'],
]
// stored content of attachment messages (photo, file, link, card, sticker, ...); params is a JSON string
type Attachment = { title?: string; description?: string; href?: string; thumb?: string; action?: string; params?: unknown; id?: number; catId?: number; type?: number }

type ReactionMap = Record<string, { icons: Record<string, number>; lastId: string }>

// search text: a text body, a file name, a link title
const textOf = (content: unknown) => (typeof content === 'string' ? content : ((content as { title?: string })?.title ?? null))

// E2EE messages (cmd 551) are stored decrypted; one Nexora can't read stays chat.e2ee, out of search, with its
// decryption state in e2eeStatus
const toRow = (accountId: string, { data, threadId }: Message, dec?: Decrypted): Row => {
  const e2ee = E2EE_CMDS.includes(Number(data.cmd))
  const read = e2ee && dec?.status === E2EE_STATUS.OK
  const content = read ? dec.content : data.content
  return {
    accountId,
    msgId: String(data.msgId),
    cliMsgId: String(data.cliMsgId),
    toUid: threadId,
    fromUid: data.uidFrom,
    dName: data.dName,
    msgType: e2ee && !read ? E2EE : data.msgType,
    // a missing ts must not fail the NOT NULL column and drop the whole batch
    sendDttm: Number(data.ts) || Date.now(),
    message: JSON.stringify(content),
    msgText: e2ee && !read ? null : textOf(content),
    quote: read && dec.quote ? dec.quote : data.quote,
    mentions: 'mentions' in data ? data.mentions : undefined,
    ttl: data.ttl,
    status: data.status,
    notify: data.notify,
    st: data.st,
    at: data.at,
    cmd: data.cmd,
    properties: data.propertyExt,
    paramsExt: data.paramsExt,
    topOut: data.topOut,
    topOutTimeOut: data.topOutTimeOut,
    topOutImprTimeOut: data.topOutImprTimeOut,
    ...(e2ee && { e2eeStatus: dec?.status ?? null }),
  }
}

const parse = (json: string | null) => (json == null ? null : JSON.parse(json))
const parseParams = (c: { params?: unknown }) => {
  try {
    return (typeof c.params === 'string' ? JSON.parse(c.params) : (c.params ?? {})) as Record<string, unknown>
  } catch {
    return {}
  }
}
// "5 phút", "1 giờ", "1 ngày" for PC's recall limit message
const duration = (seconds: number) => (seconds % 86400 === 0 ? `${seconds / 86400} ngày` : seconds % 3600 === 0 ? `${seconds / 3600} giờ` : `${Math.round(seconds / 60)} phút`)
// PC's getPhoneNumberPro: Vietnamese numbers as 0xxx, others as +country
const phone = (n: string | null | undefined) => (!n ? undefined : n.startsWith('84') ? `0${n.slice(2)}` : n.startsWith('0') || n.startsWith('+') ? n : `+${n}`)
// receiver fields of PC's /forward, /gif, ... requests
const receiver = (threadId: string, type: ThreadType, userKey = 'toId') => (type === ThreadType.Group ? { grid: threadId, visibility: 0 } : { [userKey]: threadId })
const newer = (a: string, b: string) => BigInt(a) > BigInt(b)
const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))

@injectable()
export default class MessageService implements IMessageService {
  private delivered = new Map<string, Message[]>()
  // "account:thread:anchor" -> when the group cloud was last asked
  private cloudCalls = new Map<string, number>()

  constructor(
    @inject(TOKENS.Database) private db: Database,
    @inject(TOKENS.MessageRepository) private messages: IMessageRepository,
    @inject(ZcaService) private zca: ZcaService,
    @inject(TOKENS.ContactService) private contacts: IContactService,
    @inject(TOKENS.ConversationService) private conversations: IConversationService,
    @inject(E2eeService) private e2ee: E2eeService,
  ) {
    const guard =
      <A extends unknown[]>(name: string, fn: (...args: A) => unknown) =>
      (...args: A) =>
        void Promise.resolve()
          .then(() => fn(...args))
          .catch((e) => console.error(`[messages] ${name}`, e))
    messages.tagE2ee()
    zca.on('attached', guard('preload', (id: string) => this.preload(id)))
    zca.on('ready', guard('offline', (id: string) => this.requestOffline(id)))
    zca.on('message', guard('message', (id: string, m: Message) => this.onLive(id, m)))
    zca.on('old_messages', guard('old_messages', (id: string, ms: Message[], type: ThreadType) => this.onOffline(id, ms, type)))
    zca.on('undo', guard('undo', (id: string, u: Undo) => this.onUndo(id, u)))
    zca.on('reaction', guard('reaction', (id: string, r: Reaction) => this.onReactions(id, [r], true)))
    zca.on('old_reactions', guard('old_reactions', (id: string, rs: Reaction[], isGroup: boolean) => this.onOfflineReactions(id, rs, isGroup)))
    zca.on('seen_messages', guard('seen', (id: string, s: SeenMessage[]) => this.onSeen(id, s)))
    zca.on('delivered_messages', guard('delivered', (id: string, d: DeliveredMessage[]) => this.onDelivered(id, d)))
    zca.on('typing', guard('typing', (id: string, t: Typing) => this.onTyping(id, t)))
    zca.on('group_event', guard('group_event', (id: string, e: GroupEvent) => this.onGroupEvent(id, e)))
    e2ee.on('messages', guard('e2ee_offline', (id: string, ms: TMessage[]) => this.onE2eeOffline(id, ms)))
    e2ee.on('changed', (id: string) => broadcast({ type: 'threads', accountId: id }))
  }

  // ===== Reads =====

  threads(accountId: string, limit: number): Thread[] {
    this.messages.purgeExpired(accountId)
    return this.messages
      .threads(accountId, limit)
      .map(({ message, isGroup, e2ee, ...t }) => ({ ...t, isGroup: !!isGroup, e2ee: !!e2ee, content: parse(message) }))
  }

  // Local history first; groups fall back to Zalo's group cloud when local runs out (1-1 history beyond what
  // this account received only exists on the phone, as in Zalo PC). "Cloud của tôi" too, read like a group with
  // isOA: 1 as PC does, but kept as the 1-1 conversation it is (messages to it go out as to a user). The cloud is best-effort as on PC: when Zalo
  // refuses it (e.g. 604 "Lỗi không xác định" for some groups) the local messages still show.
  async history(accountId: string, threadId: string, before: string | undefined, limit: number, from?: string) {
    this.messages.purgeExpired(accountId)
    // jump to a message (search result, pin): it and everything newer, so the list stays contiguous to the newest
    if (from) {
      const target = this.get(accountId, from)
      const rows = this.messages.listFrom(accountId, threadId, target.sendDttm, JUMP_LIMIT)
      return { messages: rows.reverse().map((r) => this.toMessageRow(accountId, r)), hasMore: true }
    }
    const cursor = before ? this.messages.find(accountId, before)?.sendDttm : undefined
    const local = () => this.messages.listBefore(accountId, threadId, cursor ?? Number.MAX_SAFE_INTEGER, limit)
    let rows = local()
    let hasMore = rows.length === limit
    const oldest = rows.at(-1)?.msgId ?? before
    const key = `${accountId}:${threadId}:${oldest}`
    const myCloud = this.isMyCloud(accountId, threadId)
    if (!hasMore && (myCloud || this.messages.isGroup(accountId, threadId)) && this.zca.has(accountId) && Date.now() - (this.cloudCalls.get(key) ?? 0) > CLOUD_SAME_PARAMS_MS) {
      this.cloudCalls.set(key, Date.now())
      try {
        const cloud = await this.zca.get(accountId).getGroupCloudMessages(threadId, { msgId: oldest ?? '0', direction: oldest ? 'old' : 'recent', count: limit, ...(myCloud && { isOA: true }) })
        this.store(accountId, myCloud ? cloud.groupMsgs.map((m) => Object.assign(m, { type: ThreadType.User })) : cloud.groupMsgs)
        rows = local()
        hasMore = !!cloud.hasMore
      } catch (e) {
        console.error(`[${accountId}] group cloud ${threadId}`, e)
      }
    }
    return { messages: rows.reverse().map((r) => this.toMessageRow(accountId, r)), hasMore }
  }

  // Zalo PC's "Ảnh/Video", "File" and "Link" sections of the conversation info, read from local history as PC does.
  media(accountId: string, threadId: string, kind: MediaKind, limit: number) {
    return this.messages
      .media(accountId, threadId, kind, limit)
      .map(({ message, ...m }) => ({ ...m, content: parse(message) }))
  }

  // Zalo PC "Tìm kiếm trong trò chuyện" (search V2): the words as one phrase whose last word is a prefix; tones, đ, case
  // and punctuation ignored; optional sender and time range (both bounds exclusive); newest first.
  search(accountId: string, threadId: string, { q, fromUid, since, until, limit, offset }: SearchRequest) {
    this.messages.purgeExpired(accountId)
    const words = q.replace(/[đĐ]/g, 'd').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (!words) return []
    return this.messages
      .search({ match: `"${words}"*`, accountId, threadId, fromUid: fromUid ?? null, since: since ?? 0, until: until ?? Number.MAX_SAFE_INTEGER, limit, offset })
      .map((r) => this.toMessageRow(accountId, r))
  }

  // Zalo PC's "Tin đánh dấu" tab: starred messages of every conversation, newest star first
  starred(accountId: string) {
    this.messages.purgeExpired(accountId)
    return this.messages
      .starred(accountId)
      .map((r) => this.toMessageRow(accountId, r))
  }

  // Zalo PC "Thông tin tin nhắn" of an own group message: members who have seen / received it, from getStatusMsg's
  // per-member marks plus the receipts that came live. Groups over SEEN_MAX_MEMBERS get no lists, as on PC.
  async info(accountId: string, threadId: string, msgId: string): Promise<MessageInfo> {
    const m = this.get(accountId, msgId)
    const members: string[] = parse(this.messages.groupMembers(accountId, threadId)?.memberIds ?? null) ?? []
    if (members.length > SEEN_MAX_MEMBERS) return { seen: [], delivered: [], hidden: true, maxMembers: SEEN_MAX_MEMBERS }
    const receipts = this.messages.receipts(accountId, msgId)
    const seen = new Set<string>(parse(receipts?.seenUids ?? null) ?? [])
    const delivered = new Set<string>(parse(receipts?.deliveredUids ?? null) ?? [])
    const others = members.filter((id) => id !== accountId)
    // ponytail: response nesting read from PC's getStatusMsg, not checked against a live reply; live receipts still count
    try {
      const raw = (await this.zca.get(accountId).getMessageStatus(threadId, ThreadType.Group, others)) as unknown
      const body = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { data?: unknown }
      const data = (typeof body?.data === 'string' ? JSON.parse(body.data) : (body?.data ?? body)) as { statusInfos?: unknown; data?: { statusInfos?: unknown } }
      const infos = (data?.statusInfos ?? data?.data?.statusInfos ?? []) as { ids?: { id: string; seen?: string; deliver?: string }[] }[]
      for (const { id, seen: s, deliver: d } of infos.flatMap((i) => i.ids ?? [])) {
        if (s && BigInt(m.msgId) <= BigInt(s)) seen.add(String(id))
        else if (d && BigInt(m.msgId) <= BigInt(d)) delivered.add(String(id))
      }
    } catch (e) {
      console.error(`[${accountId}] message status ${threadId}`, e)
    }
    const people = (ids: string[]) => ids.filter((id) => id !== accountId).map((id) => ({ userId: id, name: this.messages.displayName(accountId, id) ?? id, avatar: this.messages.avatar(accountId, id) }))
    return { seen: people([...seen]), delivered: people([...delivered].filter((id) => !seen.has(id))), hidden: false, maxMembers: SEEN_MAX_MEMBERS }
  }

  // ===== Sending =====

  async sendText(accountId: string, threadId: string, req: SendMessageRequest) {
    const api = this.zca.get(accountId)
    const isGroup = this.messages.isGroup(accountId, threadId)
    const quoted = req.quoteMsgId ? this.get(accountId, req.quoteMsgId) : undefined
    if (quoted?.fromUid === null) throw new HTTPException(400, { message: 'Không trả lời được tin nhắn hệ thống' })
    const ttl = this.conversations.ttl(accountId, threadId)

    if (!isGroup && this.e2eeOn(accountId, threadId)) {
      // ponytail: E2EE text and styles only; replies need PC's sendMsgQuote (7 encrypted fields + the owner's global id)
      if (quoted) throw new HTTPException(400, { message: E2EE_UNSUPPORTED })
      const sent = await this.e2ee.sendText(accountId, api, threadId, req.text, req.styles).catch((e) => {
        throw e instanceof HTTPException || e instanceof ZaloApiError ? e : new HTTPException(502, { message: `Không gửi được tin nhắn mã hóa đầu cuối: ${e.message}` })
      })
      const row: Row = {
        accountId,
        msgId: sent.msgId,
        cliMsgId: sent.cliMsgId,
        toUid: threadId,
        fromUid: accountId,
        msgType: 'webchat',
        sendDttm: Date.now(),
        message: JSON.stringify(sent.content),
        msgText: req.text,
        cmd: E2EE_CMDS[0],
        e2eeStatus: E2EE_STATUS.OK,
      }
      this.messages.save(accountId, [{ row, isGroup: false, isSelf: true }])
      this.announce(accountId, [sent.msgId])
      return { msgId: sent.msgId }
    }

    const res = await api.sendMessage(
      {
        msg: req.text,
        mentions: req.mentions,
        // zca's TextStyle lacks PC's f_20 and comma-joined codes; it sends st as given
        styles: req.styles as unknown as Style[] | undefined,
        urgency: req.urgency,
        ttl,
        quote: quoted && {
          content: parse(quoted.message),
          msgType: quoted.msgType,
          propertyExt: parse(quoted.properties) ?? undefined,
          uidFrom: quoted.fromUid,
          msgId: quoted.msgId,
          cliMsgId: quoted.cliMsgId ?? '0',
          ts: String(quoted.sendDttm),
          ttl: quoted.ttl ?? 0,
        },
      },
      threadId,
      isGroup ? ThreadType.Group : ThreadType.User,
    )
    const msgId = res.message ? String(res.message.msgId) : undefined
    // Stored right away; the listener echo of our own message (selfListen) fills in the rest by msgId.
    if (msgId) {
      const row: Row = {
        accountId,
        msgId,
        toUid: threadId,
        fromUid: accountId,
        msgType: 'webchat',
        sendDttm: Date.now(),
        // formatted text comes back as PC's rtf content: { action: 'rtf', title, params: { styles } }
        message: JSON.stringify(req.styles?.length ? { action: 'rtf', title: req.text, params: JSON.stringify({ styles: req.styles, ver: 0 }) } : req.text),
        msgText: req.text,
        mentions: req.mentions,
        ttl,
        quote: quoted && { ownerId: quoted.fromUid, globalMsgId: quoted.msgId, cliMsgId: quoted.cliMsgId, ts: quoted.sendDttm, msg: quoted.msgText ?? '', fromD: quoted.dName, attach: '' },
      }
      this.messages.save(accountId, [{ row, isGroup, isSelf: true }])
      this.announce(accountId, [msgId])
    }
    return { msgId }
  }

  // Attachment rows arrive through the listener echo.
  async sendAttachments(accountId: string, threadId: string, { files, text, dims }: SendAttachmentsRequest) {
    this.requirePlain(accountId, threadId)
    const attachments = await Promise.all(
      files.map(async (f, i) => {
        if (!/\.[^.]+$/.test(f.name)) throw new HTTPException(400, { message: `Tên file cần có phần mở rộng: ${f.name}` })
        return { data: Buffer.from(await f.arrayBuffer()), filename: f.name as `${string}.${string}`, metadata: { totalSize: f.size, ...dims[i] } }
      }),
    )
    const res = await this.zca.get(accountId).sendMessage({ msg: text, attachments, ttl: this.conversations.ttl(accountId, threadId) }, threadId, this.type(accountId, threadId))
    return { msgIds: [res.message, ...res.attachment].filter((r) => r != null).map((r) => String(r.msgId)) }
  }

  async sendSticker(accountId: string, threadId: string, sticker: SendStickerRequest) {
    this.requirePlain(accountId, threadId)
    const res = await this.zca.get(accountId).sendSticker(sticker, threadId, this.type(accountId, threadId))
    return { msgId: String(res.msgId) }
  }

  // Zalo PC "Gửi danh thiếp": one card per friend through /forward (msgType 6), QR codes best-effort (PC sends the
  // card without one when mget-qr fails), phone only when "Gửi kèm số điện thoại" is ticked. Rows arrive by the echo.
  async sendCards(accountId: string, threadId: string, { userIds, withPhone }: SendCardsRequest) {
    this.requirePlain(accountId, threadId)
    if (userIds.length > MAX_CARDS) throw new HTTPException(400, { message: `Bạn chỉ có thể chia sẻ ${MAX_CARDS} danh thiếp` })
    const api = this.zca.get(accountId)
    const qr = await api.getQR(userIds).catch(() => ({}) as Record<string, string>)
    const type = this.type(accountId, threadId)
    for (const userId of userIds) {
      const number = withPhone ? phone(this.messages.phoneNumber(accountId, userId)?.phoneNumber) : undefined
      await this.forwardTo(api, threadId, type, FORWARD_CONTACT, { contactUid: userId, qrCodeUrl: qr[userId] ?? '', ...(number ? { phone: number } : {}) }, this.conversations.ttl(accountId, threadId))
    }
  }

  // Zalo PC's composer preview of the first URL (parselink, always server-side): null when Zalo has nothing to show
  async linkPreview(accountId: string, url: string): Promise<LinkPreview | null> {
    if (url.length > MAX_URL) return null
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const { data, error_maps: errors = {} } = await this.zca.get(accountId).parseLink(/%[0-9a-f]{2}/i.test(href) ? href : encodeURI(href))
    if (!data || errors['3'] === 2) return null
    const thumb = errors['2'] ? '' : (data.thumb ?? '')
    if (!thumb && !(data.title && data.desc)) return null
    return { href, title: (data.title ?? '').slice(0, LINK_TITLE), desc: (data.desc ?? '').slice(0, LINK_DESC), thumb, src: data.src ?? '', media: data.media ?? null }
  }

  // Zalo PC sends a text whose preview is ready as one link message carrying the whole text (zca's sendLink parses
  // again and rewrites the text, so the request is built here as PC's sendLinkMessage)
  async sendLink(accountId: string, threadId: string, { text, preview, mentions }: SendLinkRequest) {
    this.requirePlain(accountId, threadId)
    const api = this.zca.get(accountId)
    const isGroup = this.messages.isGroup(accountId, threadId)
    const { imei, language } = api.getContext()
    await zaloPost(api, isGroup ? 'group' : 'chat', isGroup ? '/api/group/sendlink' : '/api/message/link', {
      msg: text,
      href: preview.href,
      src: preview.src,
      title: preview.title || preview.href,
      desc: preview.desc,
      language,
      thumb: preview.thumb,
      type: preview.media?.type ?? 0,
      media: JSON.stringify(preview.media ?? preview),
      ttl: this.conversations.ttl(accountId, threadId),
      clientId: nextClientId(),
      ...(isGroup ? { grid: threadId, imei, mentionInfo: JSON.stringify(mentions ?? []) } : { toId: threadId, mentionInfo: '' }),
    })
  }

  // Zalo PC's GIF tab: trending until 2+ characters are typed, then search (no "#")
  async gifs(accountId: string, q: string, offset: number): Promise<Gif[]> {
    const api = this.zca.get(accountId)
    const keyword = q.replace(/#/g, '').trim()
    const { data_list } = keyword.length >= 2 ? await api.searchGif(keyword, offset, GIF_PAGE) : await api.getTrendingGifs(offset, offset ? GIF_PAGE : GIF_FIRST_PAGE)
    return (data_list ?? [])
      .filter((g) => g.normal?.url)
      .map((g) => ({ id: String(g.id ?? ''), url: g.original.url, thumb: g.normal!.url, width: g.original.width, height: g.original.height }))
  }

  // Zalo PC's sendGif: a Giphy GIF by URL, params on the query string; zca can only upload a .gif file
  async sendGif(accountId: string, threadId: string, gif: Gif) {
    this.requirePlain(accountId, threadId)
    const api = this.zca.get(accountId)
    const type = this.type(accountId, threadId)
    await zaloPost(
      api,
      'file',
      type === ThreadType.Group ? '/api/group/gif' : '/api/message/gif',
      {
        thumb: gif.thumb,
        width: gif.width,
        height: gif.height,
        msg: '',
        type: 0,
        href: gif.url,
        contentId: gif.id,
        src: GIF_SRC_CHAT,
        ttl: this.conversations.ttl(accountId, threadId),
        ...receiver(threadId, type, 'toid'),
        clientId: nextClientId(),
      },
      true,
    )
  }

  async react(accountId: string, threadId: string, msgId: string, icon: Reactions) {
    const target = this.get(accountId, msgId)
    const res = await this.zca.get(accountId).addReaction(icon, {
      data: { msgId, cliMsgId: target.cliMsgId ?? '0' },
      threadId,
      type: this.type(accountId, threadId),
    })
    // Applied now under the reaction's own id, so the listener echo of it is skipped as already seen.
    const reaction = {
      threadId,
      data: { uidFrom: accountId, msgId: String(res.msgIds[0] ?? Date.now()), ts: String(Date.now()), content: { rMsg: [{ gMsgID: msgId, cMsgID: target.cliMsgId }], rIcon: icon, rType: icon ? 0 : -1 } },
    } as unknown as Reaction
    this.onReactions(accountId, [reaction], true)
  }

  async undo(accountId: string, threadId: string, msgId: string) {
    const target = this.get(accountId, msgId)
    this.checkRecall(accountId, [target])
    await this.zca.get(accountId).undo({ msgId, cliMsgId: target.cliMsgId ?? '0' }, threadId, this.type(accountId, threadId))
    this.messages.recall(accountId, msgId)
    broadcast({ type: 'undo', accountId, msgId })
    broadcast({ type: 'threads', accountId })
  }

  // Zalo PC "Chọn nhiều tin nhắn" → "Thu hồi": one multi_undo request for up to MAX_RECALL own recent messages
  async undoMany(accountId: string, threadId: string, msgIds: string[]) {
    if (msgIds.length > MAX_RECALL) throw new HTTPException(400, { message: `Bạn không thể thu hồi nhiều hơn ${MAX_RECALL} tin nhắn đồng thời` })
    const targets = msgIds.map((id) => this.get(accountId, id))
    if (targets.some((t) => t.toUid !== threadId)) throw new HTTPException(404, { message: 'Không tìm thấy tin nhắn' })
    this.checkRecall(accountId, targets)
    await this.zca.get(accountId).undoMany(targets.map((t) => ({ msgId: t.msgId, cliMsgId: t.cliMsgId ?? '0' })), threadId, this.type(accountId, threadId))
    for (const t of targets) {
      this.messages.recall(accountId, t.msgId)
      broadcast({ type: 'undo', accountId, msgId: t.msgId })
    }
    broadcast({ type: 'threads', accountId })
  }

  // local only, as on PC (staredDttm)
  star(accountId: string, msgId: string, starred: boolean) {
    this.get(accountId, msgId)
    this.messages.setStarred(accountId, msgId, starred)
  }

  async deleteForMe(accountId: string, threadId: string, msgId: string) {
    const target = this.get(accountId, msgId)
    // system messages exist only here
    if (target.fromUid !== null)
      await this.zca.get(accountId).deleteMessage(
        { data: { msgId, cliMsgId: target.cliMsgId ?? '0', uidFrom: target.fromUid }, threadId, type: this.type(accountId, threadId) },
        true,
      )
    this.messages.remove(accountId, threadId, msgId)
    broadcast({ type: 'threads', accountId })
  }

  // Zalo PC "Xóa hội thoại": deleteconver up to the last message, for this account only (onlyMe); the thread leaves
  // the list until a new message arrives
  async deleteConversation(accountId: string, threadId: string) {
    const last = this.messages.last(accountId, threadId)
    if (last) await this.zca.get(accountId).deleteChat({ ownerId: last.fromUid!, cliMsgId: last.cliMsgId ?? '0', globalMsgId: last.msgId }, threadId, this.type(accountId, threadId))
    this.forgetThreads(accountId, [threadId])
  }

  // local history of these threads, gone ("Xóa hội thoại", "Đặt lại mã PIN")
  forgetThreads(accountId: string, threadIds: string[]) {
    if (!threadIds.length) return
    this.messages.forgetThreads(accountId, threadIds)
    broadcast({ type: 'threads', accountId })
  }

  // Zalo PC "Chia sẻ": text goes out through mforward (batched per thread type and ttl); stickers and links are sent
  // again; cards, media and files reuse the uploaded file through /forward, one request per receiver. Each receiver's
  // own "Tin nhắn tự xóa" ttl applies.
  // ponytail: no re-upload when Zalo has dropped the file (PC downloads and uploads it again); such forwards fail
  async forward(accountId: string, threadId: string, msgId: string, to: string[]) {
    const source = this.get(accountId, msgId)
    if (source.toUid !== threadId) throw new HTTPException(404, { message: 'Không tìm thấy tin nhắn' })
    const content = parse(source.message)
    const c = (content && typeof content === 'object' ? content : {}) as Attachment
    if (source.msgType !== 'webchat' && !this.forwardable(source.msgType, c)) throw new HTTPException(400, { message: 'Không chia sẻ được loại tin nhắn này' })
    const api = this.zca.get(accountId)
    const ttl = (id: string) => this.conversations.ttl(accountId, id)
    // forwarding goes out as plaintext: never into an encrypted conversation
    const encrypted = to.filter((id) => !this.messages.isGroup(accountId, id) && this.e2ee.state(accountId, id) !== 'off')
    const blocked = encrypted.map((threadId) => ({ clientId: '', threadId, error_code: E2EE_UNSUPPORTED }))
    to = to.filter((id) => !encrypted.includes(id))
    if (source.msgType === 'webchat') {
      const batches = Map.groupBy(to, (id) => `${this.type(accountId, id)}:${ttl(id)}`)
      const results = await Promise.all(
        [...batches.values()].map((ids) => api.forwardMessage({ message: typeof content === 'string' ? content : String(c.title ?? ''), ttl: ttl(ids[0]) }, ids, this.type(accountId, ids[0]))),
      )
      return { success: results.flatMap((r) => r.success), fail: [...results.flatMap((r) => r.fail), ...blocked] }
    }
    const settled = await Promise.allSettled(to.map((id) => this.forwardOne(api, source.msgType, c, id, this.type(accountId, id), ttl(id))))
    return {
      success: to.filter((_, i) => settled[i].status === 'fulfilled').map((id) => ({ clientId: '', msgId: '', threadId: id })),
      fail: [
        ...to.flatMap((id, i) => {
          const r = settled[i]
          return r.status === 'rejected' ? [{ threadId: id, error_code: String((r.reason as Error)?.message ?? r.reason) }] : []
        }),
        ...blocked,
      ],
    }
  }

  async markSeen(accountId: string, threadId: string) {
    const isGroup = this.messages.isGroup(accountId, threadId)
    const last = this.messages.lastReceived(accountId, threadId)
    if (!last) return
    await this.zca.get(accountId).sendSeenEvent(
      {
        msgId: last.msgId,
        cliMsgId: last.cliMsgId ?? '0',
        uidFrom: last.fromUid!,
        idTo: isGroup ? threadId : accountId,
        msgType: last.msgType,
        st: last.st ?? 0,
        at: last.at ?? 0,
        cmd: last.cmd ?? 0,
        ts: last.sendDttm,
      },
      isGroup ? ThreadType.Group : ThreadType.User,
    )
    this.messages.markRead(accountId, threadId, last.msgId)
    broadcast({ type: 'threads', accountId })
  }

  async typing(accountId: string, threadId: string) {
    await this.zca.get(accountId).sendTypingEvent(threadId, this.type(accountId, threadId))
  }

  private forwardable(msgType: string, c: { action?: string }) {
    if (msgType === 'chat.sticker' || msgType in FORWARD_TYPE) return true
    return msgType === 'chat.recommended' && (c.action === 'recommened.link' || c.action === 'recommened.user')
  }

  // msgInfo per type as PC's forwardMessage builds it from the stored attachment
  private forwardOne(api: API, msgType: string, c: Attachment, threadId: string, type: ThreadType, ttl: number) {
    const p = parseParams(c)
    if (msgType === 'chat.sticker') return api.sendSticker({ id: Number(c.id), cateId: Number(c.catId), type: Number(c.type ?? 7) }, threadId, type)
    if (msgType === 'chat.recommended' && c.action === 'recommened.user') {
      const d = parseParams({ params: c.description })
      return this.forwardTo(api, threadId, type, FORWARD_CONTACT, { contactUid: String(c.params), qrCodeUrl: d.qrCodeUrl ?? '', ...(d.phone ? { phone: d.phone } : {}) }, ttl)
    }
    if (msgType === 'chat.recommended') {
      const isGroup = type === ThreadType.Group
      const { imei, language } = api.getContext()
      return zaloPost(api, isGroup ? 'group' : 'chat', isGroup ? '/api/group/sendlink' : '/api/message/link', {
        msg: c.href ?? '',
        href: c.href,
        src: p.src ?? '',
        title: c.title || c.href,
        desc: c.description ?? '',
        language,
        thumb: c.thumb ?? '',
        type: Number(p.mediaType ?? 0) || 0,
        media: JSON.stringify(p.media ?? {}),
        ttl,
        clientId: nextClientId(),
        ...(isGroup ? { grid: threadId, imei, mentionInfo: '[]' } : { toId: threadId, mentionInfo: '' }),
      })
    }
    const msgInfo: Record<string, Record<string, unknown>> = {
      'share.file': { url: c.href, fileName: c.title, extension: p.fileExt, checksum: p.checksum, size: Number(p.fileSize) || 0, fType: p.fType ?? 1, fdata: p.fdata },
      'chat.photo': { title: c.title ?? '', oriUrl: c.href, thumbUrl: c.thumb, hdUrl: p.hd || c.href, width: p.width, height: p.height, properties: JSON.stringify({ subType: 0, color: -1, size: -1, type: 0, ext: '{"sSrcType":-1,"sSrcStr":"","msg_warning_type":0}' }), fileSize: Number(p.fileSize) || 0 },
      'chat.voice': { voiceUrl: c.href, m4aUrl: p.m4a || c.href },
      'chat.gif': { href: c.href, thumbUrl: c.thumb, hdUrl: p.hd || c.href, width: p.width, height: p.height, msg: c.title ?? '' },
      'chat.video.msg': { videoUrl: c.href, thumbUrl: c.thumb, duration: p.duration, width: p.video_width ?? p.width, height: p.video_height ?? p.height, fileSize: Number(p.fileSize) || 0, title: c.title ?? '' },
      'chat.location.new': { title: c.title ?? '', desc: c.description ?? '', appId: '', lat: p.latitude, lon: p.longitude, placeId: p.placeId ?? '' },
    }
    msgInfo['chat.doodle'] = msgInfo['chat.photo']
    return this.forwardTo(api, threadId, type, FORWARD_TYPE[msgType], msgInfo[msgType], ttl)
  }

  // PC's /api/message/forward and /api/group/forward: an uploaded file or a card sent to one receiver
  private forwardTo(api: API, threadId: string, type: ThreadType, msgType: number, msgInfo: Record<string, unknown>, ttl: number) {
    return zaloPost(api, 'file', type === ThreadType.Group ? '/api/group/forward' : '/api/message/forward', {
      ...receiver(threadId, type),
      ttl,
      zsource: -1,
      msgType,
      clientId: nextClientId(),
      msgInfo: JSON.stringify(msgInfo),
      imei: api.getContext().imei,
    })
  }

  // Zalo PC recalls only the account's own messages, within settings.chat.time_undomsg
  private checkRecall(accountId: string, targets: StoredMessage[]) {
    if (targets.some((t) => t.fromUid !== accountId)) throw new HTTPException(400, { message: 'Chỉ thu hồi được tin nhắn của bạn' })
    const seconds = Number(this.zca.get(accountId).getContext().settings?.chat?.time_undomsg) || RECALL_SECONDS
    if (targets.some((t) => Date.now() - t.sendDttm >= seconds * 1000)) throw new HTTPException(400, { message: `Bạn chỉ có thể thu hồi tin nhắn trong vòng ${duration(seconds)}` })
  }

  // ===== Sync (Zalo PC order: preload last messages, then drain the offline queues over the socket) =====

  private async preload(accountId: string) {
    const local = this.messages.previews(accountId)
    const res = await this.zca.get(accountId).getLastMessages(local.map((p) => ({ threadId: p.threadId, type: p.isGroup ? ThreadType.Group : ThreadType.User, msgId: p.msgId })))
    const msgs = [...(res.msgs ?? []).map((m) => new UserMessage(accountId, m)), ...(res.groupMsgs ?? []).map((m) => new GroupMessage(accountId, m))]
    const { saved } = this.store(accountId, msgs, await this.decryptAll(accountId, msgs))
    // read on another device
    for (const c of res.clearUnreads ?? []) this.messages.markRead(accountId, c.idTo, String(c.lastMsgId))
    broadcast({ type: 'threads', accountId })
    this.learn(accountId, saved)
    await this.fetchReadMarkers(accountId)
  }

  private requestOffline(accountId: string) {
    const { listener } = this.zca.get(accountId)
    for (const type of [ThreadType.User, ThreadType.Group]) {
      listener.requestOldMessages(type, this.messages.cursor(accountId, `offline_msg_${type}`))
      listener.requestOldReactions(type, this.messages.cursor(accountId, `offline_react_${type}`))
    }
  }

  private async onOffline(accountId: string, msgs: Message[], type: ThreadType) {
    const { saved } = this.store(accountId, msgs, await this.decryptAll(accountId, msgs))
    if (saved.length) broadcast({ type: 'threads', accountId })
    this.learn(accountId, saved)
    // zca doesn't expose the queue's `more` flag: keep paging from the newest actionId until a batch adds nothing
    const next = this.advance(accountId, `offline_msg_${type}`, msgs.map((m) => m.data.actionId))
    if (next) this.zca.get(accountId).listener.requestOldMessages(type, next)
    else return this.fetchReadMarkers(accountId)
  }

  private onOfflineReactions(accountId: string, reactions: Reaction[], isGroup: boolean) {
    this.onReactions(accountId, reactions, false)
    const type = isGroup ? ThreadType.Group : ThreadType.User
    const next = this.advance(accountId, `offline_react_${type}`, reactions.map((r) => r.data.actionId))
    if (next) this.zca.get(accountId).listener.requestOldReactions(type, next)
  }

  private async onLive(accountId: string, msg: Message) {
    const { saved, undone } = this.store(accountId, [msg], await this.decryptAll(accountId, [msg]))
    this.announce(accountId, saved.map((s) => s.row.msgId))
    for (const msgId of undone) broadcast({ type: 'undo', accountId, msgId })
    this.learn(accountId, saved)
    if (!msg.isSelf) this.queueDelivered(accountId, msg)
  }

  private onUndo(accountId: string, undo: Undo) {
    const msgId = String(undo.data.content.globalMsgId)
    this.messages.recall(accountId, msgId)
    broadcast({ type: 'undo', accountId, msgId })
    broadcast({ type: 'threads', accountId })
  }

  // Each user keeps their own icon counts; `lastId` (the reaction event's id) makes re-delivery a no-op.
  private onReactions(accountId: string, reactions: Reaction[], live: boolean) {
    const touched = new Map<string, string>()
    this.db.transaction(() => {
      for (const r of reactions) {
        const { rMsg, rIcon, rType } = r.data.content
        for (const target of rMsg ?? []) {
          const msgId = String(target.gMsgID)
          const map: ReactionMap = parse(this.messages.reaction(accountId, msgId)?.reactions ?? null) ?? {}
          const entry = (map[r.data.uidFrom] ??= { icons: {}, lastId: '0' })
          if (!newer(String(r.data.msgId), entry.lastId)) continue
          entry.lastId = String(r.data.msgId)
          if (rType === -1 || !rIcon) entry.icons = {}
          else entry.icons[rIcon] = (entry.icons[rIcon] ?? 0) + 1
          this.messages.saveReaction({ accountId, rMsgId: msgId, rClientMsgId: String(target.cMsgID), idTo: r.threadId, reactions: map, lastSender: r.data.uidFrom, lastReceiveReactId: entry.lastId, lastUpdate: Number(r.data.ts) })
          touched.set(msgId, r.threadId)
        }
      }
    })()
    if (live)
      for (const [msgId, threadId] of touched) {
        const map = parse(this.messages.reaction(accountId, msgId)!.reactions)
        broadcast({ type: 'reaction', accountId, threadId, msgId, reactions: this.counts(accountId, map) })
      }
  }

  private onSeen(accountId: string, seens: SeenMessage[]) {
    for (const s of seens) {
      if (s.type === ThreadType.Group) {
        this.addReceipt(accountId, s.data.msgId, { seenUids: s.data.seenUids })
        // seen by this account on another device
        if (s.isSelf) this.messages.markRead(accountId, s.threadId, s.data.msgId)
      } else this.addReceipt(accountId, s.data.msgId, { seenUids: [s.threadId] })
      broadcast({ type: 'receipt', accountId, threadId: s.threadId })
    }
  }

  private onDelivered(accountId: string, delivereds: DeliveredMessage[]) {
    for (const d of delivereds) {
      this.addReceipt(accountId, d.data.msgId, { deliveredUids: d.data.deliveredUids, seenUids: d.data.seenUids })
      broadcast({ type: 'receipt', accountId, threadId: d.threadId })
    }
  }

  private onTyping(accountId: string, t: Typing) {
    broadcast({ type: 'typing', accountId, threadId: t.threadId, userId: t.data.uid, name: this.messages.displayName(accountId, t.data.uid) })
  }

  // Zalo PC keeps a group event as a local system message (msgId = event time, no sender, so never unread), then
  // the group is refetched so names, members, deputies and settings changed on any device show up.
  private async onGroupEvent(accountId: string, e: GroupEvent) {
    if (!GROUP_STATE_EVENTS.has(e.type)) return
    const d = e.data as TGroupEventBase
    const groupId = e.threadId
    const before = this.messages.group(accountId, groupId)
    // this account is out of the group: leaving (from any device) drops it and its conversation, as PC does; removed
    // or blocked keeps the conversation with its system message, unrefreshed; a group already dropped stays gone
    const out = OUT_EVENTS.has(e.type) && !!d.updateMembers?.some((m) => m.id === accountId)
    if (out && (!before || e.type === GroupEventType.LEAVE)) return this.leftGroup(accountId, groupId)
    // the actor's name for the text
    if (d.sourceId) await this.contacts.ensureKnown(accountId, [d.sourceId], []).catch(() => false)
    const text = groupEventText(e, { me: accountId, name: (id) => this.messages.displayName(accountId, id), setting: parse(before?.setting ?? null), creatorId: before?.creatorId })
    if (text) {
      const msgId = String(d.time || Date.now())
      const row: Row = { accountId, msgId, cliMsgId: msgId, toUid: groupId, fromUid: null, msgType: GROUP_NOTI, sendDttm: Number(msgId), message: JSON.stringify(text), msgText: text, act: e.act }
      this.messages.save(accountId, [{ row, isGroup: true, isSelf: false }])
      this.announce(accountId, [msgId])
    }
    if (!out) await this.contacts.refreshGroup(accountId, groupId)
  }

  // Zalo PC's "Mã hóa đầu cuối" upgrade of a 1-1 chat: friends only (PC's allow_stranger_chat is off), not while
  // blocked. 'pending': on, completing once the peer opens Zalo.
  async enableE2ee(accountId: string, threadId: string) {
    if (this.messages.isGroup(accountId, threadId) || this.isMyCloud(accountId, threadId)) throw new HTTPException(400, { message: 'Chỉ trò chuyện 2 người mới mã hóa đầu cuối được' })
    const rel = this.messages.relation(accountId, threadId)
    if (rel?.isBlocked) throw new HTTPException(400, { message: 'Tính năng này hiện không khả dụng, vui lòng bỏ chặn sau đó thử lại sau' })
    if (!rel?.isFr) throw new HTTPException(400, { message: 'Tính năng hiện không khả dụng. Vui lòng thử lại sau.' })
    try {
      return { status: await this.e2ee.enable(accountId, threadId) }
    } catch (e) {
      if ((e as { code?: unknown }).code === 'not_ready') throw new HTTPException(409, { message: 'Đang thiết lập cấu hình mã hóa đầu cuối, vui lòng thử lại sau' })
      const message = this.upgradeError(accountId, threadId, e as { code?: unknown; errData?: { uid: string; deviceId: number }[] })
      console.error(`[${accountId}] e2ee upgrade ${threadId}`, e)
      throw new HTTPException(502, { message })
    }
  }

  // PC's texts for a refused upgrade: GET_BUNDLE's BUNDLE_KEY_ERROR, Zalo's E2EE blacklist, the network
  private upgradeError(accountId: string, threadId: string, { code, errData }: { code?: unknown; errData?: { uid: string; deviceId: number }[] }) {
    const name = this.messages.displayName(accountId, threadId) ?? threadId
    if (code === 'NO_DEVICE' || code === -2) return `${name} không nằm trong danh sách thử nghiệm tính năng Mã hóa đầu cuối. Hãy thử nâng cấp với trò chuyện khác.`
    if (code === -3) return `${name} cần cập nhật phiên bản Zalo mới`
    if (code === -5) return 'Bạn cần cập nhật Zalo bản mới trên điện thoại và máy tính để nâng cấp mã hóa đầu cuối.'
    if (code === -10 || code === -11) return 'Tính năng hiện không khả dụng với người dùng này'
    // -9: these devices of ours have no keys
    const mine = new Set((errData ?? []).filter((d) => String(d.uid) === accountId).map((d) => Number(d.deviceId)))
    if (code === -9 && mine.size) return `Hãy đăng nhập lại ${MY_DEVICE_NAMES.filter(([d]) => mine.has(d)).map(([, n]) => n).join(', ')} và thử nâng cấp lại`
    if (code === 'timeout' || code === 'offline') return 'Hãy kiểm tra lại kết nối mạng và thử lại'
    return 'Vui lòng thử lại'
  }

  // left or dispersed: the group and its conversation go (PC's storage.deleteGroup)
  leftGroup(accountId: string, groupId: string) {
    this.forgetThreads(accountId, [groupId])
    this.contacts.forgetGroup(accountId, groupId)
  }

  // Zalo PC acks every received message so the sender sees "Đã nhận"; batched per thread (groups need one grid per call).
  private queueDelivered(accountId: string, msg: Message) {
    const queue = this.delivered.get(accountId) ?? []
    if (!queue.length) setTimeout(() => void this.flushDelivered(accountId).catch((e) => console.error('[messages] delivered', e)), 500)
    queue.push(msg)
    this.delivered.set(accountId, queue)
  }

  private async flushDelivered(accountId: string) {
    const queue = this.delivered.get(accountId) ?? []
    this.delivered.delete(accountId)
    if (!this.zca.has(accountId)) return
    const byThread = Map.groupBy(queue, (m) => `${m.type}:${m.data.idTo}`)
    for (const msgs of byThread.values())
      for (const batch of chunks(msgs, RECEIPT_BATCH))
        await this.zca.get(accountId).sendDeliveredEvent(
          false,
          batch.map(({ data }): SendDeliveredEventMessageParams => ({ msgId: data.msgId, cliMsgId: data.cliMsgId, uidFrom: data.uidFrom, idTo: data.idTo, msgType: data.msgType, st: data.st, at: data.at, cmd: data.cmd, ts: data.ts })),
          batch[0].type,
        )
  }

  // Threads without a read marker (new on this device) ask Zalo where the account stopped reading.
  private async fetchReadMarkers(accountId: string) {
    const threads = this.messages.unmarkedThreads(accountId)
    if (!threads.length || !this.zca.has(accountId)) return
    for (const batch of chunks(threads, LAST_SEEN_BATCH)) {
      const seen = await this.zca.get(accountId).getLastSeenMessages(
        batch.filter((t) => t.isGroup).map((t) => t.convId),
        batch.filter((t) => !t.isGroup).map((t) => t.convId),
      )
      for (const s of seen) this.messages.markRead(accountId, s.idTo, String(s.lastMsgId))
    }
    broadcast({ type: 'threads', accountId })
  }

  // ===== Storage =====

  // decs: decrypted E2EE messages by msgId
  private store(accountId: string, msgs: Message[], decs?: Map<string, Decrypted>) {
    const saved: Saved[] = []
    const undone: string[] = []
    this.db.transaction(() => {
      for (const m of msgs) {
        const dec = decs?.get(String(m.data.msgId))
        // the server's copy of an E2EE message this device sent: already stored decrypted
        if (dec?.status === E2EE_STATUS.DUPLICATED) continue
        const content = m.data.content as { deleteMsg?: number; globalMsgId?: number } | string
        // offline batches carry recalls as messages
        if (typeof content === 'object' && content && 'deleteMsg' in content) undone.push(String(content.globalMsgId))
        else saved.push({ row: toRow(accountId, m, dec), isGroup: m.type === ThreadType.Group, isSelf: m.isSelf })
      }
      // recalls after saving: the recalled message may be in this same batch
      this.messages.save(accountId, saved)
      for (const msgId of undone) this.messages.recall(accountId, msgId)
    })()
    return { saved, undone }
  }

  private addReceipt(accountId: string, msgId: string, add: { seenUids?: string[]; deliveredUids?: string[] }) {
    const current = this.messages.receipts(accountId, msgId)
    const merge = (json: string | null | undefined, extra?: string[]) => (extra ? [...new Set([...(parse(json ?? null) ?? []), ...extra])] : undefined)
    this.messages.saveReceipts({ accountId, msgId, seenUids: merge(current?.seenUids, add.seenUids), deliveredUids: merge(current?.deliveredUids, add.deliveredUids) })
  }

  private advance(accountId: string, key: string, actionIds: (string | undefined)[]) {
    const max = actionIds.reduce<string>((a, b) => (b && newer(b, a) ? b : a), '0')
    if (!newer(max, this.messages.cursor(accountId, key))) return undefined
    this.messages.setCursor(accountId, key, max)
    return max
  }

  // Names/avatars for strangers and groups joined since the last contacts sync.
  private learn(accountId: string, saved: Saved[]) {
    const users = saved.filter((s) => !s.isGroup).map((s) => s.row.toUid)
    const groups = saved.filter((s) => s.isGroup).map((s) => s.row.toUid)
    if (!users.length && !groups.length) return
    void this.contacts
      .ensureKnown(accountId, users, groups)
      .then((changed) => changed && broadcast({ type: 'threads', accountId }))
      .catch((e) => console.error('[messages] ensureKnown', e))
  }

  private announce(accountId: string, msgIds: string[]) {
    for (const msgId of msgIds) {
      const row = this.messages.findFull(accountId, msgId)
      if (row) broadcast({ type: 'message', message: this.toMessageRow(accountId, row) })
    }
    if (msgIds.length) broadcast({ type: 'threads', accountId })
  }

  // ===== Helpers =====

  // E2EE messages decrypted in arrival order: each is a step of its sender's Signal chain
  private async decryptAll(accountId: string, msgs: Message[]) {
    const decs = new Map<string, Decrypted>()
    for (const m of msgs)
      if (m.type === ThreadType.User && E2EE_CMDS.includes(Number(m.data.cmd))) decs.set(String(m.data.msgId), await this.e2ee.decrypt(accountId, m.data as unknown as E2eeMessage, m.isSelf))
    return decs
  }

  // 1-1 E2EE messages from the offline queue
  private async onE2eeOffline(accountId: string, raws: TMessage[]) {
    const msgs = raws.map((m) => new UserMessage(accountId, m))
    const { saved } = this.store(accountId, msgs, await this.decryptAll(accountId, msgs))
    if (saved.length) broadcast({ type: 'threads', accountId })
    this.learn(accountId, saved)
  }

  // Whether a 1-1 message goes out end-to-end encrypted; while that's unknown it can't go out at all
  private e2eeOn(accountId: string, threadId: string) {
    const state = this.e2ee.state(accountId, threadId)
    if (state === 'pending') throw new HTTPException(409, { message: 'Đang thiết lập mã hóa đầu cuối, vui lòng thử lại sau giây lát' })
    return state === 'on'
  }

  // message types Nexora can't encrypt yet must not reach an encrypted conversation as plaintext
  private requirePlain(accountId: string, threadId: string) {
    if (!this.messages.isGroup(accountId, threadId) && this.e2eeOn(accountId, threadId)) throw new HTTPException(400, { message: E2EE_UNSUPPORTED })
  }

  private get(accountId: string, msgId: string) {
    const row = this.messages.find(accountId, msgId)
    if (!row) throw new HTTPException(404, { message: 'Không tìm thấy tin nhắn' })
    return row
  }

  // "Cloud của tôi" has its own id (the login's send2me_id), not the account's
  private isMyCloud(accountId: string, threadId: string) {
    return this.zca.has(accountId) && String(this.zca.get(accountId).getContext().loginInfo?.send2me_id ?? '') === threadId
  }

  private type(accountId: string, threadId: string) {
    return this.messages.isGroup(accountId, threadId) ? ThreadType.Group : ThreadType.User
  }

  private counts(accountId: string, map: ReactionMap | null): ReactionCount[] {
    const counts = new Map<string, ReactionCount>()
    for (const [uid, { icons }] of Object.entries(map ?? {}))
      for (const [icon, n] of Object.entries(icons)) {
        const c = counts.get(icon) ?? { icon, count: 0, mine: false }
        c.count += n
        c.mine ||= uid === accountId
        counts.set(icon, c)
      }
    return [...counts.values()].sort((a, b) => b.count - a.count)
  }

  private toMessageRow(accountId: string, r: StoredMessage & { seenUids?: string | null; deliveredUids?: string | null; reactions?: string | null }): MessageRow {
    return {
      accountId,
      threadId: r.toUid,
      msgId: r.msgId,
      cliMsgId: r.cliMsgId,
      fromUid: r.fromUid,
      dName: r.dName ?? null,
      msgType: r.msgType,
      sendDttm: r.sendDttm,
      content: parse(r.message),
      quote: parse(r.quote),
      mentions: parse(r.mentions),
      ttl: r.ttl,
      starred: !!r.staredDttm,
      reactions: this.counts(accountId, parse(r.reactions ?? null)),
      seenUids: parse(r.seenUids ?? null) ?? [],
      deliveredUids: parse(r.deliveredUids ?? null) ?? [],
      e2eeStatus: r.e2eeStatus ?? null,
    }
  }
}
