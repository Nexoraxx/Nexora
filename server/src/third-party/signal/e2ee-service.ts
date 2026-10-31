import { EventEmitter } from 'node:events'
import { inject, injectable } from 'inversify'
import type { API, TMessage } from '@hwqnq/zca-js'
import type { Database } from '../../dbs/sqlite'
import { TOKENS } from '../../di/tokens'
import { ZcaService } from '../zalo/zalo-client'
import { decodeFrame, sendFrame, tapFrames, type Frame } from '../zalo/controls'
import { E2EE_ON, SignalSqliteStore } from './signal-store'
import { E2EE_QUEUES, SIGNAL_CMD, SIGNAL_FRAMES, SignalServerManager, type SessionEvent } from './signal-server-manager'
import { E2eeSessionManager } from './e2ee-session-manager'
import { E2eeMessageReceiver, type Decrypted, type E2eeMessage } from './e2ee-message-receiver'
import { E2eeMessageSender } from './e2ee-message-sender'

const AUTH_CMD = 1
// 'pending': not known yet whether the conversation is encrypted (Zalo's list not loaded this session)
export type E2eeState = 'on' | 'off' | 'pending'

type Account = {
  store: SignalSqliteStore
  sessions: E2eeSessionManager
  receiver: E2eeMessageReceiver
  sender: E2eeMessageSender
  listLoaded: boolean
}
type Events = {
  // which conversations are encrypted changed
  changed: [accountId: string]
  // 1-1 E2EE messages from the offline queue (513/713), raw as the socket sends them
  messages: [accountId: string, msgs: TMessage[]]
}

// End-to-end encryption of 1-1 chats as Zalo PC (device 2): one Signal stack per connected account, fed from the
// chat socket. Keys never leave this process.
@injectable()
export class E2eeService extends EventEmitter<Events> {
  private accounts = new Map<string, Account>()

  constructor(
    @inject(TOKENS.Database) private db: Database,
    @inject(ZcaService) zca: ZcaService,
  ) {
    super()
    zca.on('attached', (accountId, api) => this.attach(accountId, api))
    zca.on('ready', (accountId) => void this.init(accountId).catch((e) => console.error(`[${accountId}] e2ee init`, e)))
  }

  private attach(accountId: string, api: API) {
    const store = new SignalSqliteStore(this.db, accountId)
    const rpc = new SignalServerManager((cmd, subCmd, data) => sendFrame(api.listener, cmd, subCmd, data))
    const sessions = new E2eeSessionManager(accountId, store, rpc)
    this.accounts.set(accountId, { store, sessions, receiver: new E2eeMessageReceiver(store, sessions), sender: new E2eeMessageSender(accountId, store, sessions), listLoaded: false })
    sessions.on('status', () => this.emit('changed', accountId))
    rpc.on('push', (cmd: number, data: { eesession?: SessionEvent[]; msgs?: TMessage[]; more?: number; lastActionId?: string }, subCmd: number) => {
      if (E2EE_QUEUES.has(cmd)) return void this.onQueue(accountId, api, cmd, subCmd, data).catch((e) => console.error(`[${accountId}] e2ee queue ${cmd}`, e))
      if (data.eesession?.length) void sessions.onSessionEvents(cmd, data.eesession)
    })
    tapFrames(api.listener, (cmd, subCmd, frame, cipherKey) => {
      if (cmd === AUTH_CMD) return void this.onAuth(accountId, api, frame).catch((e) => console.error(`[${accountId}] e2ee auth`, e))
      if (SIGNAL_FRAMES.has(cmd)) void rpc.onFrame(cmd, subCmd, frame, cipherKey).catch((e) => console.error(`[${accountId}] signal frame ${cmd}`, e))
    })
  }

  // Zalo PC's initialize: this device's bundle on the server, then which conversations are encrypted
  private async init(accountId: string) {
    const a = this.accounts.get(accountId)
    if (!a) return
    await a.sessions.loadE2eeList(await a.sessions.ensureRegistered())
    a.listLoaded = true
    this.emit('changed', accountId)
  }

  // The auth frame lists the socket's offline queues (qCmds); the E2EE ones are pulled as PC's doGetOffline does,
  // from the last action id seen.
  private async onAuth(accountId: string, api: API, frame: Frame) {
    if (!frame.key) return
    const auth = (await decodeFrame(frame, frame.key)) as { data?: { qCmds?: { cmd: number; subCmd: number }[] } } | undefined
    for (const q of auth?.data?.qCmds ?? []) if (E2EE_QUEUES.has(q.cmd)) this.pull(accountId, api, q.cmd, q.subCmd, true)
  }

  private pull(accountId: string, api: API, cmd: number, subCmd: number, first: boolean) {
    sendFrame(api.listener, cmd, subCmd, { first, reqId: `e2ee_q_${Date.now()}`, lastId: this.cursor(accountId, cmd, subCmd) ?? 1, preIds: [] })
  }

  private async onQueue(accountId: string, api: API, cmd: number, subCmd: number, data: { eesession?: SessionEvent[]; msgs?: TMessage[]; more?: number; lastActionId?: string }) {
    if (cmd === SIGNAL_CMD.SESSION_OFFLINE) await this.accounts.get(accountId)?.sessions.onSessionEvents(cmd, data.eesession ?? [])
    else if (data.msgs?.length) this.emit('messages', accountId, data.msgs)
    if (data.lastActionId) this.setCursor(accountId, cmd, subCmd, String(data.lastActionId))
    if (data.more) this.pull(accountId, api, cmd, subCmd, false)
  }

  private cursor(accountId: string, cmd: number, subCmd: number) {
    return this.db.query<{ val: string }, [string, string]>(`SELECT val FROM kv WHERE accountId = ? AND key = ?`).get(accountId, `e2ee_queue_${cmd}_${subCmd}`)?.val
  }

  private setCursor(accountId: string, cmd: number, subCmd: number, val: string) {
    this.db.run(`INSERT INTO kv (accountId, key, val) VALUES (?, ?, ?) ON CONFLICT (accountId, key) DO UPDATE SET val = excluded.val`, [accountId, `e2ee_queue_${cmd}_${subCmd}`, val])
  }

  // Before Zalo's list is in, a conversation that was encrypted (as far as this DB knows) waits rather than risk a
  // plaintext message, which would turn the peer's E2EE off.
  state(accountId: string, uid: string): E2eeState {
    const a = this.accounts.get(accountId)
    if (new SignalSqliteStore(this.db, accountId).meta(uid).status === E2EE_ON) return a ? 'on' : 'pending'
    if (a?.listLoaded) return 'off'
    const seen = this.db.query<{ one: number }, [string, string]>(`SELECT 1 AS one FROM message WHERE accountId = ? AND toUid = ? AND cmd = ${SIGNAL_CMD.RECEIVE_ONEONE} LIMIT 1`).get(accountId, uid)
    return seen ? 'pending' : 'off'
  }

  async decrypt(accountId: string, m: E2eeMessage, isSelf: boolean): Promise<Decrypted> {
    return (await this.accounts.get(accountId)?.receiver.decrypt(m, isSelf)) ?? {}
  }

  // turns E2EE on with uid (Zalo PC's manual upgrade) once this device's keys and Zalo's list are in
  enable(accountId: string, uid: string) {
    const a = this.accounts.get(accountId)
    if (!a?.listLoaded) throw Object.assign(new Error('E2EE not initialized'), { code: 'not_ready' })
    return a.sessions.enable(uid)
  }

  sendText(accountId: string, api: API, uid: string, text: string, styles?: unknown[]) {
    const a = this.accounts.get(accountId)
    if (!a) throw new Error('Mã hóa đầu cuối chưa sẵn sàng')
    return a.sender.sendText(api, uid, text, styles)
  }

  sendSticker(accountId: string, api: API, uid: string, sticker: { id: number; catId: number; type: number }) {
    const a = this.accounts.get(accountId)
    if (!a) throw new Error('Mã hóa đầu cuối chưa sẵn sàng')
    return a.sender.sendSticker(api, uid, sticker)
  }

  sendGif(accountId: string, api: API, uid: string, gif: { url: string; thumb: string; width: number; height: number }) {
    const a = this.accounts.get(accountId)
    if (!a) throw new Error('Mã hóa đầu cuối chưa sẵn sàng')
    return a.sender.sendGif(api, uid, gif)
  }
}
