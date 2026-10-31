import type { API } from '@hwqnq/zca-js'
import type { SignalSqliteStore } from './signal-store'
import type { E2eeSessionManager } from './e2ee-session-manager'
import { nextClientId, zaloPost } from '../zalo/post'
import { numberToBuffer } from './e2ee-content'

// what was sent, as a received copy would read once decrypted
export type SentE2ee = { msgId: string; cliMsgId: string; content: unknown }
type SendResult = { msgId?: string | number } | undefined
// a per-device encrypt closure: each field is its own Signal message for that device
type Encrypt = (plaintext: string | Buffer) => Promise<string>

// Zalo PC's 1-1 E2EE send: each content field is encrypted once per device of the receiver and of this account's other
// devices, one listParams entry each, POSTed to the chat_e2e service's per-type endpoint (/message/sms, /sticker, ...).
export class E2eeMessageSender {
  constructor(
    private accountId: string,
    private store: SignalSqliteStore,
    private sessions: E2eeSessionManager,
  ) {}

  // encrypt `build`'s fields for every target device and POST them. `build` gets a per-device encrypt and returns that
  // device's content fields; the receiver's registration id (iid) rides in e2eeExt so it can spot a message for an older bundle.
  private async fanout(api: API, peerUid: string, action: string, build: (enc: Encrypt) => Promise<Record<string, unknown>>): Promise<{ res: SendResult; clientId: string }> {
    const targets = [
      ...(await this.sessions.devices(peerUid)).map((d) => [peerUid, d] as const),
      ...(await this.sessions.devices(this.accountId)).map((d) => [this.accountId, d] as const),
    ]
    if (!targets.some(([uid]) => uid === peerUid)) throw new Error('Người nhận chưa có thiết bị nhận được tin nhắn mã hóa đầu cuối')
    const senderIid = this.store.registrationId()
    const clientId = nextClientId()
    const listParams = []
    for (const [uid, deviceId] of targets) {
      let registrationId = 0
      const enc: Encrypt = async (plaintext) => {
        // an empty field stays unencrypted and is left out, as PC's encrypt()
        if (typeof plaintext === 'string' && !plaintext) return ''
        const r = await this.sessions.encrypt(uid, deviceId, plaintext)
        registrationId = r.registrationId
        return r.cipher
      }
      listParams.push({
        ...(await build(enc)),
        e2eeExt: JSON.stringify({ version: 0, compat_version: 0, sender_iid: senderIid, ...(registrationId && { iid: registrationId }) }),
        toId: uid,
        platform: deviceId,
      })
    }
    const res = await zaloPost<SendResult>(api, 'chat_e2e', `/api/e2ee/pc/message/${action}`, { listParams: JSON.stringify(listParams), destType: 3, threadId: peerUid, clientId })
    return { res, clientId }
  }

  // the self-echo of our own send comes back encrypted too; answer it from the cache instead of decrypting
  private async sent(clientId: string, res: SendResult, content: unknown): Promise<SentE2ee> {
    await this.store.saveDeciphered(`${clientId}_${this.accountId}`, JSON.stringify({ content }))
    return { msgId: String(res?.msgId ?? clientId), cliMsgId: clientId, content }
  }

  async sendText(api: API, peerUid: string, text: string, styles?: unknown[]): Promise<SentE2ee> {
    // an empty field stays unencrypted and is left out, as PC's encrypt()
    const textProperties = styles?.length ? JSON.stringify({ styles, ver: 0 }) : ''
    const { res, clientId } = await this.fanout(api, peerUid, 'sms', async (enc) => ({
      message: await enc(text),
      ...(textProperties && { textProperties: await enc(textProperties) }),
    }))
    return this.sent(clientId, res, textProperties ? { action: 'rtf', title: text, params: textProperties } : text)
  }

  // sticker ids are encrypted as 4-byte little-endian integers; the wire fields are stickerId/cateId/type (the server
  // delivers them back as id/catId/type)
  async sendSticker(api: API, peerUid: string, sticker: { id: number; catId: number; type: number }): Promise<SentE2ee> {
    const { res, clientId } = await this.fanout(api, peerUid, 'sticker', async (enc) => ({
      stickerId: await enc(numberToBuffer(sticker.id)),
      cateId: await enc(numberToBuffer(sticker.catId)),
      type: await enc(numberToBuffer(sticker.type)),
    }))
    return this.sent(clientId, res, { id: sticker.id, catId: sticker.catId, type: sticker.type })
  }

  // Zalo PC's sendGif (Giphy by URL): href and thumb are plain-string ciphers (not upload links); width/height/type/src
  // ride as plaintext metadata the receiver ignores. params (prmE2EE) is empty for a Giphy gif.
  async sendGif(api: API, peerUid: string, gif: { url: string; thumb: string; width: number; height: number }): Promise<SentE2ee> {
    const { res, clientId } = await this.fanout(api, peerUid, 'gif', async (enc) => ({
      href: await enc(gif.url),
      thumb: await enc(gif.thumb),
      width: gif.width,
      height: gif.height,
      msg: '',
      type: 0,
      src: 1,
    }))
    return this.sent(clientId, res, { href: gif.url, thumb: gif.thumb, width: gif.width, height: gif.height, type: 0 })
  }
}
