import { EventEmitter } from 'node:events'
import {
  getLibSignal,
  deriveIdentityKeyPair,
  type KeyPair,
  type PreKey,
  type SignedPreKey,
} from './libsignal'
import type { SignalSqliteStore } from './signal-store'
import type {
  SignalServerManager,
  PreKeyBundlePayload,
  PeerBundleResponse,
} from './signal-server-manager'
import { toBase64, fromBase64 } from './crypto'

export class E2eeSessionManager extends EventEmitter {
  private currentOpId = 0

  constructor(
    private accountId: string,
    private store: SignalSqliteStore,
    private rpc: SignalServerManager,
  ) {
    super()
    this.rpc.on('request_prekeys', (data) => {
      if (data?.type === 1) {
        void this.replenishPreKeys(20).catch((e) => console.error('[e2ee] replenishPreKeys error', e))
      } else if (data?.type === 2) {
        void this.registerNewBundle().catch((e) => console.error('[e2ee] registerNewBundle error', e))
      }
    })
  }

  async ensureRegistered(): Promise<void> {
    const keyInfo = await this.rpc.getKeyId()
    let localRegId: number | null = null
    try {
      localRegId = await this.store.getLocalRegistrationId()
    } catch {
      localRegId = null
    }

    if (!keyInfo || localRegId === null || keyInfo.keyId !== localRegId) {
      await this.registerNewBundle()
    }
  }

  async registerNewBundle(): Promise<{ ts: number }> {
    const lib = getLibSignal()
    const identity: KeyPair = await deriveIdentityKeyPair(this.accountId, 2)
    const regId: number = lib.KeyHelper.generateRegistrationId()
    await this.store.saveIdentityKeyPair(identity, regId)

    const signedPreKey: SignedPreKey = await lib.KeyHelper.generateSignedPreKey(identity, regId + 1)
    await this.store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair)

    this.currentOpId = 0
    const opKeys: PreKey[] = []
    for (let i = 0; i < 20; i++) {
      this.currentOpId++
      const opKeyId = regId + 2 + this.currentOpId
      const opk: PreKey = await lib.KeyHelper.generatePreKey(opKeyId)
      await this.store.storePreKey(opk.keyId, opk.keyPair)
      opKeys.push(opk)
    }

    const payload: PreKeyBundlePayload = {
      delSS: 1,
      key: {
        deviceId: 2,
        preKey: {
          iKey: { id: regId, key: toBase64(identity.pubKey) },
          signature: toBase64(signedPreKey.signature),
          spKey: { id: signedPreKey.keyId, key: toBase64(signedPreKey.keyPair.pubKey) },
        },
        opKeys: opKeys.map((k) => ({
          id: k.keyId,
          key: toBase64(k.keyPair.pubKey),
        })),
      },
    }

    return this.rpc.submitBundle(payload)
  }

  async replenishPreKeys(count = 20): Promise<{ ts: number }> {
    const lib = getLibSignal()
    const regId = await this.store.getLocalRegistrationId()
    const opKeys: PreKey[] = []
    for (let i = 0; i < count; i++) {
      this.currentOpId++
      const opKeyId = regId + 2 + this.currentOpId
      const opk: PreKey = await lib.KeyHelper.generatePreKey(opKeyId)
      await this.store.storePreKey(opk.keyId, opk.keyPair)
      opKeys.push(opk)
    }

    return this.rpc.submitPreKeys({
      deviceId: 2,
      id: regId,
      opKeys: opKeys.map((k) => ({
        id: k.keyId,
        key: toBase64(k.keyPair.pubKey),
      })),
    })
  }

  async getOrBuildSessions(peerUid: string): Promise<string[]> {
    const lib = getLibSignal()
    const bundleResp: PeerBundleResponse = await this.rpc.getBundle([
      { uid: peerUid, deviceId: -1 },
    ])
    const peerData = bundleResp?.keys?.find((k) => k.uid === peerUid)
    if (!peerData || !peerData.keys || peerData.keys.length === 0) {
      return []
    }

    const activeAddresses: string[] = []
    for (const dev of peerData.keys) {
      const address = new lib.SignalProtocolAddress(`${peerUid}_${dev.deviceId}`, dev.deviceId)
      const addressStr = address.toString()
      const existingSession = await this.store.loadSession(addressStr)

      if (!existingSession && dev.preKey) {
        const builder = new lib.SessionBuilder(this.store, address)
        await builder.processPreKey({
          registrationId: dev.preKey.iKey.id,
          identityKey: fromBase64(dev.preKey.iKey.key),
          signedPreKey: {
            keyId: dev.preKey.spKey.id,
            publicKey: fromBase64(dev.preKey.spKey.key),
            signature: fromBase64(dev.preKey.signature),
          },
          preKey: dev.opKeys?.[0]
            ? {
                keyId: dev.opKeys[0].id,
                publicKey: fromBase64(dev.opKeys[0].key),
              }
            : undefined,
        })

        const cipher = new lib.SessionCipher(this.store, address)
        const handshakeMsg = JSON.stringify({ subDevice: [] })
        const encrypted = await cipher.encrypt(Buffer.from(handshakeMsg, 'utf8'))
        const cipherBuf = Buffer.concat([
          Buffer.from([3, 0x33]),
          Buffer.from(encrypted.body, 'binary'),
        ])
        await this.rpc
          .initSession(peerUid, [
            {
              deviceId: dev.deviceId,
              data: cipherBuf.toString('base64'),
            },
          ])
          .catch((e) => console.error('[e2ee] initSession error', e))
      }

      activeAddresses.push(addressStr)
    }

    return activeAddresses
  }

  async handleIncomingInitSession(fromUid: string, data: any[]): Promise<void> {
    const lib = getLibSignal()
    for (const item of data ?? []) {
      const deviceId = Number(item.deviceId)
      const rawData = item.data
      if (!rawData || typeof rawData !== 'string') continue

      const buf = Buffer.from(rawData, 'base64')
      if (buf.length < 3) continue
      const body = buf.subarray(2)

      const address = new lib.SignalProtocolAddress(`${fromUid}_${deviceId}`, deviceId)
      const cipher = new lib.SessionCipher(this.store, address)
      try {
        await cipher.decryptPreKeyWhisperMessage(
          body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
          'binary',
        )
        const replyPlaintext = JSON.stringify({ subDevice: [] })
        const replyEncrypted = await cipher.encrypt(Buffer.from(replyPlaintext, 'utf8'))
        const replyBuf = Buffer.concat([
          Buffer.from([replyEncrypted.type]),
          Buffer.from(replyEncrypted.body, 'binary'),
        ])
        await this.rpc.ackInitSession(fromUid, [
          {
            deviceId,
            ts: Date.now(),
            data: replyBuf.toString('base64'),
          },
        ])
      } catch (err) {
        console.error(`[e2ee] failed to decrypt init session from ${fromUid}:${deviceId}`, err)
      }
    }
  }
}
