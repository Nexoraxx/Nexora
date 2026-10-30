import { describe, expect, it } from 'bun:test'
import { openDatabase } from '../../dbs/sqlite'
import { SignalSqliteStore } from './signal-store'
import { E2eeSessionManager } from './e2ee-session-manager'

describe('E2eeSessionManager', () => {
  it('registers bundle when server has no key or mismatched keyId', async () => {
    const db = openDatabase(':memory:')
    db.run(
      `INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('user_test', 'Test', 'imei1', '{}', 'agent', 1000)`
    )
    const store = new SignalSqliteStore(db, 'user_test')
    let bundleSubmitted: any = null
    const fakeRpc = {
      getKeyId: async () => null, // err -1: no key
      submitBundle: async (bundle: any) => {
        bundleSubmitted = bundle
        return { ts: Date.now() }
      },
      on: () => {},
    } as any

    const sessionManager = new E2eeSessionManager('user_test', store, fakeRpc)
    await sessionManager.ensureRegistered()

    expect(bundleSubmitted).toBeDefined()
    expect(bundleSubmitted.key.deviceId).toBe(2)
    expect(bundleSubmitted.key.opKeys.length).toBe(20)
    expect(await store.getLocalRegistrationId()).toBeDefined()
    expect(await store.loadPreKey(bundleSubmitted.key.opKeys[0].id)).toBeDefined()
  })
})
