import { PC_DEVICE, type SignalSqliteStore } from './signal-store'
import type { E2eeSessionManager } from './e2ee-session-manager'

// Zalo PC's MSG_E2EE* message states (stored in message.e2eeStatus)
export const E2EE_STATUS = { OK: 3000, FAILED: 3001, CHANGE_DEVICE: 3003, DUPLICATED: 3006 } as const
// PC's VERSION_MSG.TEXT_MSG compat_version: newer formats can't be read
const COMPAT_VERSION = 0

// status undefined: not attempted (a message type Nexora can't decrypt yet)
export type Decrypted = { status?: number; content?: unknown; quote?: Quote }
type Quote = { msg?: unknown; fromD?: unknown; gOwnerId?: unknown; attach?: unknown; [key: string]: unknown }
// zca's message data of a cmd-551 message
export type E2eeMessage = {
  cliMsgId: string
  uidFrom: string
  msgType: string
  content: unknown
  quote?: Quote
  paramsExt?: unknown
  e2ee?: unknown
}

const parseJson = <T>(v: unknown): T | undefined => {
  try {
    return (typeof v === 'string' ? JSON.parse(v) : v) as T
  } catch {
    return undefined
  }
}

// Zalo PC's decryptMsgFromServer for 1-1 messages: every field is its own Signal message, read in the order PC's
// extractTextContentFromServer lists them
export class E2eeMessageReceiver {
  constructor(
    private store: SignalSqliteStore,
    private sessions: E2eeSessionManager,
  ) {}

  // isSelf: sent by this account (zca already put our uid in uidFrom)
  async decrypt(m: E2eeMessage, isSelf: boolean): Promise<Decrypted> {
    const key = `${m.cliMsgId}_${m.uidFrom}`
    const deviceId = Number(parseJson<{ platformType?: number }>(m.paramsExt)?.platformType ?? 0)
    try {
      // a message delivered twice (or our own send, kept at send time) is read once
      const cached = await this.store.getDeciphered(key)
      if (cached) return { status: E2EE_STATUS.OK, ...JSON.parse(cached) }
      // the server's copy of our own send ("sender chain"): nothing to decrypt for this device
      if (isSelf && deviceId === PC_DEVICE) return { status: E2EE_STATUS.DUPLICATED }
      const ext = parseJson<{ compat_version?: number; iid?: number }>(m.e2ee)
      if ((ext?.compat_version ?? 0) > COMPAT_VERSION) return { status: E2EE_STATUS.FAILED }
      // encrypted for a bundle this device no longer has
      if (ext?.iid && ext.iid !== this.store.registrationId()) return { status: E2EE_STATUS.CHANGE_DEVICE }
      if (m.msgType !== 'webchat') return {}

      const read = (cipher: unknown) => (typeof cipher === 'string' && cipher ? this.sessions.decrypt(m.uidFrom, deviceId, cipher) : Promise.resolve(cipher))
      const c = m.content as { action?: string; title?: string; params?: string } | string
      let content: unknown
      if (typeof c === 'object' && c?.action === 'rtf') {
        const title = await read(c.title)
        content = { ...c, title, params: await read(c.params) }
      } else content = await read(c)
      let quote: Quote | undefined
      if (m.quote) {
        const q = m.quote
        const msg = q.msg as { action?: string; title?: string } | string | undefined
        quote = { ...q, msg: typeof msg === 'object' && msg?.action === 'rtf' ? { ...msg, title: await read(msg.title) } : await read(msg) }
        for (const f of ['fromD', 'gOwnerId', 'attach'] as const) if (typeof q[f] === 'string') quote[f] = await read(q[f])
      }
      const out = { content, ...(quote && { quote }) }
      await this.store.saveDeciphered(key, JSON.stringify(out))
      return { status: E2EE_STATUS.OK, ...out }
    } catch (e) {
      console.error(`[e2ee] decrypt ${key} from device ${deviceId}`, e)
      return { status: E2EE_STATUS.FAILED }
    }
  }
}
