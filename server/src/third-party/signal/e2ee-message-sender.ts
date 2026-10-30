import type { API } from '@hwqnq/zca-js'
import type { SignalSqliteStore } from './signal-store'
import type { E2eeSessionManager } from './e2ee-session-manager'
import { nextClientId, zaloPost } from '../zalo/post'

// what was sent, as a received copy would read once decrypted
export type SentE2ee = { msgId: string; cliMsgId: string; content: unknown }

// Zalo PC's sendZText for 1-1: the text and its styles (textProperties) are encrypted for every device of the
// receiver and every other device of this account, one listParams entry each, POSTed to the chat_e2e service.
export class E2eeMessageSender {
  constructor(
    private accountId: string,
    private store: SignalSqliteStore,
    private sessions: E2eeSessionManager,
  ) {}

  async sendText(api: API, peerUid: string, text: string, styles?: unknown[]): Promise<SentE2ee> {
    const targets = [
      ...(await this.sessions.devices(peerUid)).map((d) => [peerUid, d] as const),
      ...(await this.sessions.devices(this.accountId)).map((d) => [this.accountId, d] as const),
    ]
    if (!targets.some(([uid]) => uid === peerUid)) throw new Error('Người nhận chưa có thiết bị nhận được tin nhắn mã hóa đầu cuối')
    const textProperties = styles?.length ? JSON.stringify({ styles, ver: 0 }) : ''
    const senderIid = this.store.registrationId()
    const clientId = nextClientId()
    const listParams = []
    for (const [uid, deviceId] of targets) {
      const { cipher, registrationId } = await this.sessions.encrypt(uid, deviceId, text)
      // an empty field stays unencrypted and is left out, as PC's encrypt()
      const props = textProperties && (await this.sessions.encrypt(uid, deviceId, textProperties)).cipher
      listParams.push({
        message: cipher,
        ...(props && { textProperties: props }),
        // iid: the receiving device's registration id, so it can tell a message for an older bundle
        e2eeExt: JSON.stringify({ version: 0, compat_version: 0, sender_iid: senderIid, ...(registrationId && { iid: registrationId }) }),
        toId: uid,
        platform: deviceId,
      })
    }
    const res = await zaloPost<{ msgId?: string | number } | undefined>(api, 'chat_e2e', '/api/e2ee/pc/message/sms', { listParams: JSON.stringify(listParams), destType: 3, threadId: peerUid, clientId })
    const content = textProperties ? { action: 'rtf', title: text, params: textProperties } : text
    // the copy the server echoes back to this account is answered from here
    await this.store.saveDeciphered(`${clientId}_${this.accountId}`, JSON.stringify({ content }))
    return { msgId: String(res?.msgId ?? clientId), cliMsgId: clientId, content }
  }
}
