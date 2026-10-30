import { describe, expect, it } from 'bun:test'
import { openDatabase } from '../../dbs/sqlite'
import { SignalSqliteStore } from './signal-store'
import { deriveIdentityKeyPair } from './libsignal'

describe('SignalSqliteStore', () => {
  it('stores and retrieves identity, prekeys, signed prekeys and sessions', async () => {
    const db = openDatabase(':memory:')
    // insert dummy account for foreign keys
    db.run(
      `INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('user_1', 'Test User', 'imei1', '{}', 'agent', 1000)`
    )
    const accountId = 'user_1'
    const store = new SignalSqliteStore(db, accountId)

    const identity = await deriveIdentityKeyPair(accountId, 2)
    await store.saveIdentityKeyPair(identity, 12345)
    expect(await store.getLocalRegistrationId()).toBe(12345)
    const loadedId = await store.getIdentityKeyPair()
    expect(Buffer.from(loadedId.pubKey).toString('hex')).toBe(Buffer.from(identity.pubKey).toString('hex'))

    await store.storePreKey(101, identity)
    const pk = await store.loadPreKey(101)
    expect(pk).toBeDefined()
    expect(Buffer.from(pk!.pubKey).toString('hex')).toBe(Buffer.from(identity.pubKey).toString('hex'))

    await store.removePreKey(101)
    expect(await store.loadPreKey(101)).toBeUndefined()

    await store.storeSignedPreKey(202, identity)
    const spk = await store.loadSignedPreKey(202)
    expect(spk).toBeDefined()
    expect(Buffer.from(spk!.pubKey).toString('hex')).toBe(Buffer.from(identity.pubKey).toString('hex'))

    await store.storeSession('peer_1.2', 'session_data_json')
    expect(await store.loadSession('peer_1.2')).toBe('session_data_json')

    // isTrustedIdentity should always return true for Zalo compatibility
    expect(await store.isTrustedIdentity('peer_1.2', identity.pubKey)).toBe(true)

    // deciphered cache
    await store.saveDeciphered('msg_123', 'Decrypted text content')
    expect(await store.getDeciphered('msg_123')).toBe('Decrypted text content')
  })
})
