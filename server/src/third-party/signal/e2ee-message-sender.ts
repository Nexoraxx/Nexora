import { createHash } from 'node:crypto'
import type { API } from '@hwqnq/zca-js'
import { getLibSignal } from './libsignal'
import type { SignalSqliteStore } from './signal-store'
import type { E2eeSessionManager } from './e2ee-session-manager'
import { nextClientId, zaloPost } from '../zalo/post'

export interface SendE2eeTextOptions {
  quote?: any
  clientId?: string
}

export class E2eeMessageSender {
  constructor(
    private accountId: string,
    private store: SignalSqliteStore,
    private sessionMgr: E2eeSessionManager,
  ) {}

  async encryptField(address: any, plaintext: string): Promise<string> {
    const lib = getLibSignal()
    const cipher = new lib.SessionCipher(this.store, address)
    const encrypted = await cipher.encrypt(Buffer.from(plaintext, 'utf8'))
    const cipherBuf = Buffer.concat([
      Buffer.from([encrypted.type]),
      Buffer.from(encrypted.body, 'binary'),
    ])
    return cipherBuf.toString('base64')
  }

  async postHttp(api: API, path: string, params: Record<string, unknown>): Promise<any> {
    return zaloPost(api, 'chat_e2e' as any, path, params)
  }

  async sendTextMessage(
    api: API,
    peerUid: string,
    text: string,
    options?: SendE2eeTextOptions,
  ): Promise<any> {
    const lib = getLibSignal()
    const senderRegId = await this.store.getLocalRegistrationId()
    const activeAddresses = await this.sessionMgr.getOrBuildSessions(peerUid)
    if (!activeAddresses || activeAddresses.length === 0) {
      throw new Error('Không thể thiết lập phiên mã hóa với người nhận')
    }

    const clientId = options?.clientId ?? nextClientId()
    const listParams: any[] = []

    for (const addrStr of activeAddresses) {
      // addrStr format: "<uid>_<deviceId>.<deviceId>"
      const parts = addrStr.split('.')
      const deviceId = Number(parts[1] ?? 2)
      const address = new lib.SignalProtocolAddress(`${peerUid}_${deviceId}`, deviceId)

      const cipherMessage = await this.encryptField(address, text)

      // Store hash for resend v3
      const hash = createHash('sha256').update(cipherMessage).digest('hex')
      try {
        const db = (this.store as any).db
        if (db) {
          db.run(
            `INSERT INTO e2ee_hash (accountId, sha256, ts) VALUES (?, ?, ?)
             ON CONFLICT(accountId, sha256) DO NOTHING`,
            [this.accountId, hash, Date.now()],
          )
        }
      } catch {
        // non-blocking
      }

      listParams.push({
        message: cipherMessage,
        clientId,
        toId: peerUid,
        platform: deviceId,
        e2eeExt: JSON.stringify({
          version: 0,
          compat_version: 0,
          sender_iid: senderRegId,
          iid: 0,
        }),
      })
    }

    const path = options?.quote ? '/api/e2ee/pc/message/quote' : '/api/e2ee/pc/message/sms'
    const body = {
      listParams: JSON.stringify(listParams),
      destType: 3,
      threadId: peerUid,
      clientId,
    }

    return await this.postHttp(api, path, body)
  }
}
