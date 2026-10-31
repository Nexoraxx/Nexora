import { PC_DEVICE, type SignalSqliteStore } from './signal-store'
import type { E2eeSessionManager } from './e2ee-session-manager'
import { normalizeType, FIELD_SPECS, getBase64Key, isE2eeUploadLink, updateBase64Key, bufferToNumber, type Field } from './e2ee-content'

// Zalo PC's MSG_E2EE* message states (stored in message.e2eeStatus)
export const E2EE_STATUS = { OK: 3000, FAILED: 3001, CHANGE_DEVICE: 3003, DUPLICATED: 3006 } as const
// PC's VERSION_MSG.*.compat_version: newer formats can't be read
const COMPAT_VERSION = 0

// status undefined: not attempted (a message type Nexora can't decrypt yet)
export type Decrypted = { status?: number; content?: unknown; quote?: Quote }
type Quote = { msg?: unknown; fromD?: unknown; gOwnerId?: unknown; attach?: unknown; [key: string]: unknown }
type Content = Record<string, unknown>
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

type Reader = (cipher: unknown) => Promise<unknown>

const parseJson = <T>(v: unknown): T | undefined => {
  try {
    return (typeof v === 'string' ? JSON.parse(v) : v) as T
  } catch {
    return undefined
  }
}

// Zalo PC's decryptMsgFromServer for 1-1 messages: each content field is its own Signal message (Signal caches skipped
// keys, so fields decrypt independently and order is not required). Which fields a type carries, and how each maps back
// into content, comes from PC's extractTextContentFromServer / the decrypt switch, captured in FIELD_SPECS.
export class E2eeMessageReceiver {
  constructor(
    private store: SignalSqliteStore,
    private sessions: E2eeSessionManager,
  ) {}

  // isSelf: sent by this account (zca already put our uid in uidFrom)
  async decrypt(m: E2eeMessage, isSelf: boolean): Promise<Decrypted> {
    const key = `${m.cliMsgId}_${m.uidFrom}`
    const deviceId = Number(parseJson<{ platformType?: number }>(m.paramsExt)?.platformType ?? 0)
    // encrypted for another bundle than ours: PC still tries (its iid validation), it may be an older one of ours
    let otherIid = false
    try {
      // a message delivered twice (or our own send, kept at send time) is read once
      const cached = await this.store.getDeciphered(key)
      if (cached) return { status: E2EE_STATUS.OK, ...JSON.parse(cached) }
      // the server's copy of our own send ("sender chain"): nothing to decrypt for this device
      if (isSelf && deviceId === PC_DEVICE) return { status: E2EE_STATUS.DUPLICATED }
      const ext = parseJson<{ compat_version?: number; iid?: number }>(m.e2ee)
      if ((ext?.compat_version ?? 0) > COMPAT_VERSION) return { status: E2EE_STATUS.FAILED }
      otherIid = !!ext?.iid && ext.iid !== this.store.registrationId()

      const type = normalizeType(m.msgType)
      if (!type) return {} // a type Nexora doesn't decrypt: kept as chat.e2ee

      // empty fields are sent unencrypted (PC's encrypt() skips "" and null), so pass them through untouched
      const read: Reader = (cipher) => (typeof cipher === 'string' && cipher ? this.sessions.decrypt(m.uidFrom, deviceId, cipher) : Promise.resolve(cipher))

      const out =
        type === 'text'
          ? await this.decryptText(m, read)
          : type === 'sticker'
            ? { content: await this.decryptSticker(m, deviceId) }
            : type === 'contact'
              ? { content: await this.decryptContact(m, read) }
              : { content: await this.decryptSpec(m, read, FIELD_SPECS[type]) }

      await this.store.saveDeciphered(key, JSON.stringify(out))
      return { status: E2EE_STATUS.OK, ...out }
    } catch (e) {
      console.error(`[e2ee] decrypt ${key} (${m.msgType}) from device ${deviceId}`, e)
      // unreadable and meant for a bundle this device no longer has
      return { status: otherIid ? E2EE_STATUS.CHANGE_DEVICE : E2EE_STATUS.FAILED }
    }
  }

  // webchat: the text (or rtf title + params) and the quoted-message fields
  private async decryptText(m: E2eeMessage, read: Reader): Promise<{ content: unknown; quote?: Quote }> {
    const c = m.content as { action?: string; title?: string; params?: string } | string
    const content = typeof c === 'object' && c?.action === 'rtf' ? { ...c, title: await read(c.title), params: await read(c.params) } : await read(c)
    let quote: Quote | undefined
    if (m.quote) {
      const q = m.quote
      const msg = q.msg as { action?: string; title?: string } | string | undefined
      quote = { ...q, msg: typeof msg === 'object' && msg?.action === 'rtf' ? { ...msg, title: await read(msg.title) } : await read(msg) }
      for (const f of ['fromD', 'gOwnerId', 'attach'] as const) if (typeof q[f] === 'string') quote[f] = await read(q[f])
    }
    return { content, ...(quote && { quote }) }
  }

  // photo/file/voice/video/doodle/gif/location: a flat list of content fields. 'key' fields hold the cipher in the
  // href's e2esession= param (media upload links); plain fields hold the cipher directly.
  private async decryptSpec(m: E2eeMessage, read: Reader, spec: Field[]): Promise<Content> {
    const content: Content = { ...(m.content as Content) }
    for (const f of spec) {
      const v = content[f.name]
      if (v == null || (f.opt && !v)) continue
      if (f.kind === 'key' && isE2eeUploadLink(v)) {
        const plain = await read(getBase64Key(v))
        content[f.name] = plain === 'null' ? '' : updateBase64Key(v as string, String(plain))
      } else {
        content[f.name] = await read(v)
      }
    }
    return content
  }

  // chat.sticker: id/catId/type are 4-byte little-endian integers; extInfo.params is a utf8 string
  private async decryptSticker(m: E2eeMessage, deviceId: number): Promise<Content> {
    const content: Content = { ...(m.content as Content) }
    const num = async (v: unknown) => (typeof v === 'string' && v ? bufferToNumber(await this.sessions.decryptRaw(m.uidFrom, deviceId, v)) : v)
    content.id = await num(content.id)
    content.catId = await num(content.catId)
    content.type = await num(content.type)
    const ext = parseJson<{ params?: unknown }>(content.extInfo)
    if (typeof ext?.params === 'string' && ext.params) content.extInfo = JSON.stringify({ params: (await this.sessions.decryptRaw(m.uidFrom, deviceId, ext.params)).toString('utf8') })
    return content
  }

  // chat.recommended: a link preview, an OA/sticker-set card, or a shared contact card, by content.action
  private async decryptContact(m: E2eeMessage, read: Reader): Promise<Content> {
    const content: Content = { ...(m.content as Content) }
    const action = content.action
    if (action === 'recommened.link') {
      content.href = await read(content.href)
      content.params = await read(content.params)
      content.title = await read(content.title)
      content.thumb = isE2eeUploadLink(content.thumb) ? updateBase64Key(content.thumb as string, String(await read(getBase64Key(content.thumb)))) : await read(content.thumb)
      content.description = await read(content.description)
      content.type = await read(content.type)
    } else {
      // recommened.vip / recommened.stickerset / shared contact card: title, thumb, href, description are the ciphers
      content.title = await read(content.title)
      content.thumb = await read(content.thumb)
      content.href = await read(content.href)
      content.description = await read(content.description)
    }
    return content
  }
}
