import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { inject, injectable } from 'inversify'
import { HTTPException } from 'hono/http-exception'
import { GroupMessage, UserMessage, type API, type Message, type TGroupMessage } from '@hwqnq/zca-js'
import type { Database } from '../../dbs/sqlite'
import { TOKENS } from '../../di/tokens'
import { broadcast } from '../../core'
import { ZcaService } from '../zalo/zalo-client'
import { controlData, sendFrame, tapFrames, type Control } from '../zalo/controls'
import { zaloGet } from '../zalo/post'
import { SignalServerManager } from '../signal/signal-server-manager'
import { decryptMessage, decryptMetadata, generateKeyPair, initZproto, type KeyPair } from './zproto'
import { decodeConversations, decodeMessages, decompress, frames, type SyncAttach, type SyncConversation, type SyncMessage } from './sync2-chunk'

// Zalo PC's "Đồng bộ tin nhắn" (sync v2, pc-dist/shared-worker.*.js + lazy/main-startup.*.js): the PC asks the phone
// over the chat socket (SYNC_MESSAGE.REQUEST) for the rows of one of its databases ("conversation", "message"), the
// user taps ĐỒNG BỘ NGAY on the phone, the phone uploads encrypted batches and announces each one as a
// transfer_sync2 control. The first batch's metadata cipher, opened with our identity (ik) and ephemeral (ek) keys,
// gives the session record that decrypts the rest.
export const SYNC_CMD = { REQUEST: 590, DISPOSE: 591 }
const MOBILE = 0
const SYNC_FULL = 0
const HIGH = 0
// SCpg: the phone's transfer_status
const STATUS = { ACTIVE: 1, IDLE: 2, WAITING_CONFIRM: 3, CONFIRMED: 4, BYPASS_CONFIRMED: 5, USER_REJECT: 6, USER_CANCEL: 7, BUSY: 8, LOW_STORAGE: 9, LOGOUT: 10 }
const DISPOSE = { USER_CANCEL: 0, SUCCESS: 1, ERROR: 2 }
const METADATA_BATCH = 2
const SEEN = 5
const NOT_SUPPORTED = 211
const NO_RETRY = new Set<unknown>(['offline', 'timeout', NOT_SUPPORTED])
const RECORD_MS = 60_000
// PC's sync2-download-service: 60 s per try, 3 retries 1 s apart
const DOWNLOAD_MS = 60_000
const DOWNLOAD_TRIES = 4
// sync_2_pc remote-config defaults: manual_sync awaiting_mobile_timeout_ms / batch_timeout, sync_paused_timeout_ms
const CONFIRM_MS = 600_000
const BATCH_MS = 10_000
const PAUSED_MS = 600_000
const BATCH_SIZE = 2000
// PC's "no limit" (fo)
const ALL = 2147483647
// PC's prepare sends at most 30 queries per request; sync_recent_chat: 100 messages per conversation
const QUERIES_PER_REQUEST = 30
// ponytail: recent messages only; PC's sync_all_remaining_msg also pulls older history by missing range, add it with range tracking
export const MSG_LIMIT = 100

// lang-vi strings of the same cases
const MOBILE_ERRORS: Record<number, string> = {
  [STATUS.USER_REJECT]: 'Bạn đã từ chối yêu cầu đồng bộ trên điện thoại',
  [STATUS.USER_CANCEL]: 'Bạn đã dừng đồng bộ trên điện thoại',
  [STATUS.BUSY]: 'Điện thoại đang bận đồng bộ hoặc sao lưu dữ liệu. Hãy thử lại sau.',
  [STATUS.LOW_STORAGE]: 'Giải phóng một ít dung lượng trên điện thoại của bạn và thử lại',
  [STATUS.LOGOUT]: 'Đã xảy ra lỗi trong quá trình đồng bộ',
}
const ERR = {
  confirm: 'Bạn cần xác nhận trên điện thoại để bắt đầu đồng bộ',
  failed: 'Đã xảy ra lỗi trong quá trình đồng bộ',
  version: 'Phiên bản Zalo trên điện thoại của bạn chưa hỗ trợ tính năng này',
  offline: 'Hãy kiểm tra kết nối mạng và thử lại',
  expired: 'Yêu cầu đồng bộ đã hết hiệu lực',
  cancelled: 'Đã dừng đồng bộ',
  disabled: 'Zalo chưa bật tính năng đồng bộ tin nhắn cho tài khoản này',
}

export type SyncPhase = 'waiting_confirm' | 'preparing' | 'syncing' | 'paused' | 'done' | 'error'
export type SyncState = { state: SyncPhase; progress?: number; conversations?: number; messages?: number; error?: string }
type Batch = { syncId: string; idx: number; isLast?: boolean; err?: number; errorCode?: number; batchType: number; msgUrl: string; scopes?: { partition: string }[] }
type Query = { partition: string; from: number; to: number; limit: number }
type Session = {
  syncId: string
  ik: KeyPair
  ek: KeyPair
  record: PromiseWithResolvers<Uint8Array>
  done: PromiseWithResolvers<void>
  seen: Set<number>
  total: number
  processed: number
  queue: Promise<void>
  timer?: ReturnType<typeof setTimeout>
  // (re)arms the wait for the phone's next step
  timeout(ms: number, message: string): void
  // PC's checkRequestfulfilled: every batch up to the last one announced
  fulfilled(): boolean
  onBatch(b: Batch): void
}
// opened: sessions the server took, disposed together at the end as PC closes its remote databases; uids: global id → uid
type Run = { rpc: SignalServerManager; ik: KeyPair; ussidx: number; session?: Session; opened: string[]; uids: Record<string, string>; status: SyncState; cancelled: boolean }
type Events = { messages: [accountId: string, msgs: Message[], readUpTo: Map<string, string>] }

// PC's generateRandomString: [A-Za-z0-9]
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const random = (n: number) => Array.from(randomBytes(n), (b) => ALNUM[b % ALNUM.length]).join('')
// features.sync_2_pc of getserverinfo, an object or its JSON
const syncEnabled = (flag: unknown) => {
  try {
    return !!(typeof flag === 'string' ? JSON.parse(flag) : flag)?.enable
  } catch {
    return false
  }
}
// cause: what actually failed (Zalo's error code, ...), logged; message: what the user sees
const fail = (message: string, cause?: unknown) => Object.assign(new Error(message, { cause }), { sync: true })

@injectable()
export class Sync2Service extends EventEmitter<Events> {
  private rpcs = new Map<string, SignalServerManager>()
  private runs = new Map<string, Run>()
  // sockets past their auth frame (cmd 1): PC's _send holds every frame until then
  private authed = new Set<string>()

  constructor(
    @inject(TOKENS.Database) private db: Database,
    @inject(ZcaService) private zca: ZcaService,
  ) {
    super()
    zca.on('ready', (accountId) => this.authed.add(accountId))
    zca.on('status', (accountId, status) => status !== 'online' && this.authed.delete(accountId))
    zca.on('attached', (accountId, api) => {
      const rpc = new SignalServerManager((cmd, subCmd, data) => {
        if (!this.authed.has(accountId)) throw Object.assign(new Error('Mất kết nối tới máy chủ'), { code: 'offline' })
        sendFrame(api.listener, cmd, subCmd, data)
      }, 'req_')
      this.rpcs.set(accountId, rpc)
      // PC fails what's waiting on a closing socket (ERR_SOCKET_CLOSED) rather than letting it time out
      api.listener.on('disconnected', () => rpc.abortAll('closed'))
      api.listener.on('closed', () => rpc.abortAll('closed'))
      tapFrames(api.listener, (cmd, subCmd, frame, cipherKey) => {
        if (cmd !== SYNC_CMD.REQUEST && cmd !== SYNC_CMD.DISPOSE) return
        console.log(`[${accountId}] sync frame ${cmd}/${subCmd} error_code=${frame.error_code} encrypt=${frame.encrypt}`)
        void rpc.onFrame(cmd, subCmd, frame, cipherKey).catch((e) => console.error(`[${accountId}] sync frame ${cmd}`, e))
      })
    })
    // PC's _processSync2Ctrl: transfer_sync2 (and transfer_msg once sync v2 is on)
    zca.on('control', (accountId, c) => {
      if (c.act_type === 'transfer_sync2' || c.act_type === 'transfer_msg') this.onControl(accountId, c)
    })
  }

  status(accountId: string): SyncState | null {
    return this.runs.get(accountId)?.status ?? null
  }

  start(accountId: string): SyncState {
    const running = this.runs.get(accountId)
    if (running && !['done', 'error'].includes(running.status.state)) return running.status
    // 409 when the account isn't connected; a connected one always has its socket rpc
    const api = this.zca.get(accountId)
    // PC's SyncController.isFeatureEnabled: no sync v2 unless the server turns it on for the account
    const flag = api.getContext().settings?.features?.sync_2_pc
    console.log(`[${accountId}] sync: features.sync_2_pc =`, JSON.stringify(flag))
    if (!syncEnabled(flag)) throw new HTTPException(400, { message: ERR.disabled })
    const rpc = this.rpcs.get(accountId)!
    const run: Run = { rpc, ik: { publicKey: new Uint8Array(), privateKey: new Uint8Array() }, ussidx: 0, opened: [], uids: {}, status: { state: 'waiting_confirm' }, cancelled: false }
    this.runs.set(accountId, run)
    this.emitStatus(accountId, run)
    void this.sync(accountId, api, run).catch((e) => {
      console.error(`[${accountId}] sync failed:`, (e as { sync?: boolean }).sync ? [(e as Error).message, (e as Error).cause] : e)
      this.setStatus(accountId, run, { state: 'error', error: (e as { sync?: boolean }).sync ? (e as Error).message : ERR.failed })
    })
    return run.status
  }

  cancel(accountId: string) {
    const run = this.runs.get(accountId)
    if (!run || ['done', 'error'].includes(run.status.state)) return
    run.cancelled = true
    run.session?.done.reject(fail(ERR.cancelled))
  }

  // ===== flow: the conversation list, then the recent messages of each conversation =====

  private async sync(accountId: string, api: API, run: Run) {
    await initZproto()
    // PC's checkingIdentityKeyPair: a new identity for every manual sync
    run.ik = generateKeyPair()
    let reason = DISPOSE.ERROR
    try {
      const convs: SyncConversation[] = []
      await this.query(run, 'conversation', [{ partition: '', from: 0, to: Number.MAX_SAFE_INTEGER, limit: ALL }], (plain) => convs.push(...decodeConversations(plain)))
      const threads = await this.threadsOf(accountId, api, run, convs)
      run.status.conversations = threads.size

      let imported = 0
      const partitions = [...threads.keys()]
      const touched = new Set<string>()
      const onFrame = async (plain: Uint8Array) => {
        const msgs: Message[] = []
        // the phone's read state: up to its newest message seen there or sent by this account
        const readUpTo = new Map<string, string>()
        for (const p of decodeMessages(plain)) {
          const thread = threads.get(p.id)
          if (!thread || !p.messages?.length) continue
          const uids = await this.uidsOf(accountId, api, run, p.messages.flatMap((m) => peopleOf(m, thread)))
          const converted = p.messages.map((m) => toMessage(accountId, m, thread, uids))
          msgs.push(...converted.filter((m) => m !== null))
          const read = converted.filter((m, i) => m && (m.isSelf || p.messages![i].msgStatus === SEEN)).sort((a, b) => Number(b!.data.ts) - Number(a!.data.ts))[0]
          if (read) readUpTo.set(thread.id, String(read.data.msgId))
          touched.add(p.id)
        }
        this.emit('messages', accountId, msgs, readUpTo)
        imported += msgs.length
        this.setStatus(accountId, run, { state: 'syncing', progress: Math.round((touched.size / partitions.length) * 100), messages: imported })
      }
      // newest conversations first, each up to its last message
      for (let i = 0; i < partitions.length; i += QUERIES_PER_REQUEST) {
        const queries = partitions.slice(i, i + QUERIES_PER_REQUEST).map((partition) => ({ partition, from: 0, to: threads.get(partition)!.lastTs, limit: MSG_LIMIT }))
        await this.query(run, 'message', queries, onFrame)
      }
      reason = DISPOSE.SUCCESS
      this.setStatus(accountId, run, { state: 'done', progress: 100, messages: imported })
    } catch (e) {
      if (run.cancelled) reason = DISPOSE.USER_CANCEL
      throw e
    } finally {
      for (const syncId of run.opened) run.rpc.request(SYNC_CMD.DISPOSE, { syncId, toDevice: MOBILE, reason }, 0, 3000).catch(() => {})
    }
  }

  // One sync session: SYNC_MESSAGE.REQUEST, then the phone's batches until the last one.
  private async query(run: Run, type: 'conversation' | 'message', queries: Query[], onFrame: (plain: Uint8Array) => unknown) {
    if (run.cancelled) throw fail(ERR.cancelled)
    const s: Session = {
      syncId: random(32),
      ik: run.ik,
      ek: generateKeyPair(),
      record: Promise.withResolvers(),
      done: Promise.withResolvers(),
      seen: new Set(),
      total: -1,
      processed: 0,
      queue: Promise.resolve(),
      timeout(ms, message) {
        clearTimeout(s.timer)
        s.timer = setTimeout(() => s.done.reject(fail(message)), ms)
      },
      fulfilled: () => s.seen.size === s.total,
      onBatch: (b) => {
        if (s.seen.has(b.idx)) return
        s.seen.add(b.idx)
        if (b.isLast) s.total = b.idx + 1
        // once every batch is announced the phone is done; loading them isn't timed
        if (s.fulfilled()) clearTimeout(s.timer)
        else s.timeout(BATCH_MS, ERR.failed)
        let job: Promise<void>
        if (b.err) {
          // PC fails only the batch's own scope; without the metadata batch nothing can be decrypted
          console.warn(`[sync] batch ${s.syncId}/${b.idx} type ${b.batchType} failed on the phone: ${b.err}`)
          if (b.batchType === METADATA_BATCH) s.record.reject(fail(ERR.failed, { batch: b.idx, err: b.err }))
          job = b.batchType === METADATA_BATCH ? s.record.promise.then(() => {}) : Promise.resolve()
        }
        // the metadata batch right away (it unlocks the rest); message batches in order, once its record is known
        else if (b.batchType === METADATA_BATCH) job = this.loadMetadata(s, b)
        else job = s.queue = s.queue.then(() => this.load(s, b, onFrame))
        job.then(() => {
          if (++s.processed === s.total) s.done.resolve()
        }, (e) => s.done.reject(e))
      },
    }
    s.record.promise.catch(() => {})
    run.session = s
    const payload = {
      syncId: s.syncId,
      syncType: SYNC_FULL,
      ek: Buffer.from(s.ek.publicKey).toString('base64'),
      ik: Buffer.from(run.ik.publicKey).toString('base64'),
      toDevice: MOBILE,
      tempKey: '',
      deviceName: hostname(),
      req: { type, priority: HIGH, queries, batchSize: BATCH_SIZE },
      ver: 1,
      ussidx: run.ussidx++,
    }
    try {
      await this.request(run, payload)
      run.opened.push(s.syncId)
      // the phone answers with its status (waiting for the user, or straight to work when already confirmed)
      if (run.status.state === 'waiting_confirm') s.timeout(CONFIRM_MS, ERR.confirm)
      else s.timeout(BATCH_MS, ERR.failed)
      await s.done.promise
    } finally {
      clearTimeout(s.timer)
      run.session = undefined
    }
  }

  // PC's wss-utils withRetry: 3 tries, 1 s then 2 s apart, except without a socket, on a timeout and on 211. A timeout
  // or a socket lost mid-request reads "Yêu cầu đồng bộ đã hết hiệu lực"; only the missing socket is a network problem.
  private async request(run: Run, payload: object) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run.rpc.request(SYNC_CMD.REQUEST, payload)
      } catch (e) {
        const code = (e as { code?: unknown }).code
        if (attempt < 3 && !NO_RETRY.has(code)) {
          await Bun.sleep(1000 * attempt)
          continue
        }
        throw fail(code === NOT_SUPPORTED ? ERR.version : code === 'offline' ? ERR.offline : code === 'timeout' || code === 'closed' ? ERR.expired : ERR.failed, { code })
      }
    }
  }

  // The metadata batch only carries the session record: PC drops its rows (partition metadata_<syncId>)
  private async loadMetadata(s: Session, b: Batch) {
    for (const cipher of frames(await download(b.msgUrl))) s.record.resolve(decryptMetadata(cipher, s.ik, s.ek.privateKey).sessionRecord)
    // a metadata batch without a frame: the record never comes, its wait (PC's 60 s) fails the session
  }

  private async load(s: Session, b: Batch, onFrame: (plain: Uint8Array) => unknown) {
    // PC's waitSessionRecord: 60 s for the metadata batch
    const record = await new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => reject(fail(ERR.failed, 'no session record')), RECORD_MS)
      s.record.promise.then(resolve, reject).finally(() => clearTimeout(timer))
    })
    for (const cipher of frames(await download(b.msgUrl))) await onFrame(decompress(decryptMessage(cipher, record)))
  }

  private onControl(accountId: string, c: Control) {
    const run = this.runs.get(accountId)
    const s = run?.session
    if (!run || !s) return
    const data = controlData<Batch & { status?: number; fromDevice?: number }>(c)
    console.log(`[${accountId}] sync control ${c.act_type}/${c.act}`, JSON.stringify(data).slice(0, 300))
    if (data?.syncId !== s.syncId) return
    if (c.act === 'transfer_status') {
      // PC ignores the phone once every batch is in
      if (data.fromDevice !== MOBILE || s.fulfilled()) return
      switch (data.status) {
        case STATUS.WAITING_CONFIRM:
          s.timeout(CONFIRM_MS, ERR.confirm)
          return this.setStatus(accountId, run, { state: 'waiting_confirm' })
        case STATUS.CONFIRMED:
        case STATUS.BYPASS_CONFIRMED:
          s.timeout(BATCH_MS, ERR.failed)
          if (run.status.state === 'waiting_confirm') this.setStatus(accountId, run, { state: 'preparing' })
          return
        case STATUS.ACTIVE:
          s.timeout(BATCH_MS, ERR.failed)
          if (run.status.state === 'paused') this.setStatus(accountId, run, { state: 'syncing' })
          return
        // PC stops waiting for batches and gives the paused sync sync_paused_timeout_ms
        case STATUS.IDLE:
          s.timeout(PAUSED_MS, ERR.failed)
          return this.setStatus(accountId, run, { state: 'paused' })
        // stopped on the phone: a cancel, not a failure
        case STATUS.USER_CANCEL:
          run.cancelled = true
          return s.done.reject(fail(MOBILE_ERRORS[STATUS.USER_CANCEL]))
        default:
          if (data.status && MOBILE_ERRORS[data.status]) s.done.reject(fail(MOBILE_ERRORS[data.status], { status: data.status }))
      }
    } else if (c.act === 'upload_batch' || c.act === 'transfer_error') {
      if (run.status.state !== 'syncing') this.setStatus(accountId, run, { state: 'syncing' })
      // PC's SyncEventsHandler: success is upload_batch with err exactly 0; failures carry their code in errorCode
      s.onBatch({ ...data, err: c.act === 'upload_batch' && data.err === 0 ? 0 : (data.errorCode ?? data.err ?? -1) })
    }
  }

  // ===== ids: the phone speaks global ids; Nexora keeps uids and group ids =====

  // conversations that can't be mapped are dropped, as on PC; groups only from the local group list
  private async threadsOf(accountId: string, api: API, run: Run, convs: SyncConversation[]) {
    const groups = new Map(this.db.query<{ userId: string; globalId: string }, [string]>(`SELECT userId, globalId FROM groups WHERE accountId = ? AND globalId IS NOT NULL`).all(accountId).map((g) => [g.globalId, g.userId]))
    const users = await this.uidsOf(accountId, api, run, convs.filter((c) => c.convType !== GROUP).map((c) => c.convId))
    const threads = new Map<string, Thread>()
    for (const c of convs) {
      const isGroup = c.convType === GROUP
      const id = isGroup ? groups.get(c.convId) : users[c.convId]
      if (id && c.lastTs) threads.set(`${isGroup ? 'group' : 'oneone'}/${c.convId}`, { id, gid: c.convId, isGroup, lastTs: c.lastTs })
    }
    return threads
  }

  // PC's getUserIdFromDbOrServer: known users first, the rest from /api/gid/decrypt (one more round for misses);
  // results kept for the whole sync
  private async uidsOf(accountId: string, api: API, run: Run, gids: string[]) {
    const missing = () => [...new Set(gids)].filter((g) => g && g !== '-1' && !run.uids[g])
    if (!missing().length) return run.uids
    const known = this.db
      .query<{ userId: string; globalId: string }, [string, string]>(`SELECT userId, globalId FROM user WHERE accountId = ? AND globalId IN (SELECT value FROM json_each(?))`)
      .all(accountId, JSON.stringify(missing()))
    for (const u of known) run.uids[u.globalId] = u.userId
    for (let round = 0; round < 2 && missing().length; round++) {
      if (round) await Bun.sleep(500)
      const rest = missing()
      for (let i = 0; i < rest.length; i += 100)
        Object.assign(run.uids, await zaloGet<Record<string, string>>(api, 'profile', '/api/gid/decrypt', { globalUids: JSON.stringify(rest.slice(i, i + 100)) }).catch(() => ({})))
    }
    return run.uids
  }

  private setStatus(accountId: string, run: Run, status: SyncState) {
    run.status = { ...run.status, ...status }
    this.emitStatus(accountId, run)
  }

  private emitStatus(accountId: string, run: Run) {
    broadcast({ type: 'sync_status', accountId, ...run.status })
  }
}

type Thread = { id: string; gid: string; isGroup: boolean; lastTs: number }
const GROUP = 2

// proto msgType (xi) → the server's msgType (Bi); others (undo, poll, e-card, chat info) are skipped as PC does
const SERVER_TYPE: Record<number, string> = {
  0: 'webchat', 2: 'chat.doodle', 3: 'chat.photo', 4: 'chat.photo', 6: 'chat.voice', 10: 'chat.sticker', 12: 'chat.recommended',
  15: 'chat.list.action', 18: 'chat.location.new', 19: 'chat.video.msg', 22: 'share.file', 23: 'chat.gif', 24: 'chat.webcontent',
  53: 'chat.webcontent.v2', 25: 'chat.video.live.msg', 31: 'chat.photo', 33: 'chat.delete',
}
const ATTACH_TYPES = new Set([2, 3, 4, 6, 12, 18, 19, 22, 23])
const STICKER = 10
const CONTACT = 12
const RECOMMEND = new Set(['recommened.user', 'recommened.vip'])

// the global ids a message names (PC's convertToNormalizedMessages): group senders, mentions, quote owners, cards.
// A 1-1 sender is the thread's other side or this account, no lookup needed.
export const peopleOf = (m: SyncMessage, thread: Thread) => {
  const a = m.meta?.attachs?.[0]
  return [
    ...(thread.isGroup ? [m.senderId] : []),
    ...(m.meta?.mentions ?? []).map((x) => x.uid),
    ...(m.meta?.quote ? [m.meta.quote.ownerId] : []),
    ...(m.msgType === CONTACT && a?.params && RECOMMEND.has(a.action ?? '') ? [a.params] : []),
  ]
}

// PC's syncMessage2SVMessage: a synced message as the server would have sent it, so it's stored like any other
export function toMessage(accountId: string, m: SyncMessage, thread: Thread, uids: Record<string, string>): Message | null {
  const msgType = SERVER_TYPE[m.msgType]
  // ponytail: messages the phone never sent (global id 0) are skipped; PC gives them local ids
  if (!msgType || m.globalId === '0') return null
  const meta = m.meta ?? {}
  const a: SyncAttach | undefined = meta.attachs?.[0]
  const uid = (g: string) => (g === '-1' ? g : (uids[g] ?? (!thread.isGroup && g === thread.gid ? thread.id : g)))
  // in a 1-1 thread only two people talk: the other side (the thread's global id) and this account
  const own = (g: string) => (thread.isGroup ? uids[g] : g === thread.gid ? thread.id : (uids[g] ?? accountId))
  const sender = own(m.senderId)
  if (!sender) return null
  const self = sender === accountId

  let content: unknown = m.content
  if (m.msgType === 0) {
    if (a?.action === 'rtf') content = { ...a, title: a.title || m.content }
  } else if (m.msgType === 15) content = meta.attachs ?? []
  else if (m.msgType === 53) content = { zinstant_msg: a?.zinstantMsg ?? '', zinstant_data: a?.zinstantData ?? '', action: a?.action ?? '' }
  else if (m.msgType === 24) {
    if (!a?.params?.includes('pcItem')) return null
    content = attachContent(a)
  } else if (m.msgType === STICKER) content = a ?? {}
  else if (ATTACH_TYPES.has(m.msgType)) {
    content = attachContent(a ?? {})
    const c = content as SyncAttach
    if (m.msgType === CONTACT && c.params && RECOMMEND.has(c.action ?? '')) c.params = uid(c.params)
  }

  const data = {
    actionId: '',
    msgId: m.globalId,
    cliMsgId: m.clientId,
    msgType,
    uidFrom: self ? '0' : sender,
    idTo: thread.isGroup || self ? thread.id : accountId,
    dName: '',
    ts: String(m.timestamp),
    status: 1,
    content,
    notify: '1',
    ttl: meta.ttl ?? 0,
    propertyExt: meta.property as TGroupMessage['propertyExt'],
    // globalMsgId stays a string: a 19-digit id doesn't fit a double
    quote: meta.quote ? { ...meta.quote, ownerId: own(meta.quote.ownerId) ?? meta.quote.ownerId } : undefined,
    mentions: meta.mentions?.map((x) => ({ ...x, uid: uid(x.uid), type: x.type as 0 | 1 })),
    ...(meta.reference && { reference: meta.reference }),
  } as unknown as TGroupMessage
  return thread.isGroup ? new GroupMessage(accountId, data) : new UserMessage(accountId, data)
}

// PC's normalizeParams on attachment content: '' for absent strings; childnumber from a key the proto never fills, so 0
const attachContent = (a: SyncAttach) => ({ ...a, title: a.title || '', description: a.description || '', href: a.href || '', thumb: a.thumb || '', action: a.action || '', params: a.params || '', type: a.type || '', childnumber: 0 })

// PC's sync2-download-service: plain GET, 60 s per try, retried 1 s apart
async function download(url: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_MS) })
      if (!res.ok) throw fail(ERR.failed, { download: res.status })
      return new Uint8Array(await res.arrayBuffer())
    } catch (e) {
      if (attempt >= DOWNLOAD_TRIES) throw (e as { sync?: boolean }).sync ? e : fail(ERR.failed, e)
      await Bun.sleep(1000)
    }
  }
}
