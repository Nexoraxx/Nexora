import { getLibSignal } from './libsignal'
import type { SignalSqliteStore } from './signal-store'

export interface DecryptResult {
  plainText: string
  e2eeStatus: number
  error?: string
}

export class E2eeMessageReceiver {
  constructor(
    private accountId: string,
    private store: SignalSqliteStore,
  ) {}

  async decryptIncomingMessage(msgData: any): Promise<DecryptResult> {
    const cliMsgId = String(msgData.cliMsgId ?? msgData.msgId ?? '')
    const uidFrom = String(msgData.uidFrom ?? '')
    const idTo = String(msgData.idTo ?? msgData.toUid ?? '')
    const content =
      typeof msgData.content === 'string'
        ? msgData.content
        : typeof msgData.message === 'string'
          ? msgData.message
          : ''

    const cacheKey = `${cliMsgId}_${uidFrom}_${idTo}`
    if (cliMsgId) {
      const cached = await this.store.getDeciphered(cacheKey)
      if (cached) return { plainText: cached, e2eeStatus: 1 }
    }

    if (!content) {
      return {
        plainText: 'Giải mã tin nhắn không thành công',
        e2eeStatus: 3000,
        error: 'Empty ciphertext',
      }
    }

    let buf: Buffer
    try {
      buf = Buffer.from(content, 'base64')
    } catch {
      return {
        plainText: 'Giải mã tin nhắn không thành công',
        e2eeStatus: 3000,
        error: 'Invalid base64 ciphertext',
      }
    }

    if (buf.length < 2) {
      return {
        plainText: 'Giải mã tin nhắn không thành công',
        e2eeStatus: 3000,
        error: 'Ciphertext too short',
      }
    }

    const type = buf[0]
    const bodyBuf = buf.subarray(1)

    let platformType = 2
    if (msgData.paramsExt) {
      try {
        const ext =
          typeof msgData.paramsExt === 'string'
            ? JSON.parse(msgData.paramsExt)
            : msgData.paramsExt
        if (ext.platformType !== undefined) {
          platformType = Number(ext.platformType)
        }
      } catch {
        // fallback
      }
    }

    const senderUid = uidFrom === '0' || uidFrom === '' ? this.accountId : uidFrom

    try {
      const lib = getLibSignal()
      const address = new lib.SignalProtocolAddress(`${senderUid}_${platformType}`, platformType)
      const cipher = new lib.SessionCipher(this.store, address)

      const arrayBuf = bodyBuf.buffer.slice(
        bodyBuf.byteOffset,
        bodyBuf.byteOffset + bodyBuf.byteLength,
      )

      let plainText: string
      if (type === 3) {
        plainText = await cipher.decryptPreKeyWhisperMessage(arrayBuf, 'utf8')
      } else {
        plainText = await cipher.decryptWhisperMessage(arrayBuf, 'utf8')
      }

      if (cacheKey) {
        await this.store.saveDeciphered(cacheKey, plainText)
      }
      return { plainText, e2eeStatus: 1 }
    } catch (err: any) {
      if (cacheKey) {
        const retryCache = await this.store.getDeciphered(cacheKey)
        if (retryCache) return { plainText: retryCache, e2eeStatus: 1 }
      }
      return {
        plainText: 'Giải mã tin nhắn không thành công',
        e2eeStatus: 3000,
        error: err?.message ?? 'Decrypt failed',
      }
    }
  }
}
