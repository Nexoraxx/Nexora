import type { Database } from '../../dbs/sqlite'
import type { KeyPair } from './libsignal'
import { toBase64, fromBase64 } from './crypto'

export class SignalSqliteStore {
  constructor(private db: Database, private accountId: string) {}

  async getIdentityKeyPair(): Promise<KeyPair> {
    const row =
      this.db
        .query<{ keyPair: string }, [string, string]>(
          `SELECT keyPair FROM e2ee_identity WHERE accountId = ? AND keyId = ?`,
        )
        .get(this.accountId, `${this.accountId}.2`) ||
      this.db
        .query<{ keyPair: string }, [string]>(
          `SELECT keyPair FROM e2ee_identity WHERE accountId = ? LIMIT 1`,
        )
        .get(this.accountId)

    if (!row) throw new Error(`No identity key found for account ${this.accountId}`)
    const parsed = JSON.parse(row.keyPair)
    return {
      pubKey: fromBase64(parsed.pubKey),
      privKey: fromBase64(parsed.privKey),
    }
  }

  async getLocalRegistrationId(): Promise<number> {
    const row = this.db
      .query<{ regId: number }, [string]>(
        `SELECT regId FROM e2ee_registration WHERE accountId = ? LIMIT 1`,
      )
      .get(this.accountId)
    if (!row) throw new Error(`No registration ID found for account ${this.accountId}`)
    return row.regId
  }

  async saveIdentityKeyPair(kp: KeyPair, regId: number): Promise<void> {
    const ts = Date.now()
    const serialized = JSON.stringify({
      pubKey: toBase64(kp.pubKey),
      privKey: toBase64(kp.privKey),
    })
    const keyId = `${this.accountId}.2`

    this.db.run(
      `INSERT INTO e2ee_identity (accountId, keyId, keyPair, ts, regId, version)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(accountId, keyId) DO UPDATE SET keyPair=excluded.keyPair, ts=excluded.ts, regId=excluded.regId`,
      [this.accountId, keyId, serialized, ts, regId],
    )

    this.db.run(
      `INSERT INTO e2ee_registration (accountId, identifier, regId, ts)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId, identifier) DO UPDATE SET regId=excluded.regId, ts=excluded.ts`,
      [this.accountId, keyId, regId, ts],
    )
  }

  async saveIdentity(identifier: string, identityKey: ArrayBuffer): Promise<boolean> {
    const ts = Date.now()
    const serialized = JSON.stringify({ pubKey: toBase64(identityKey) })
    this.db.run(
      `INSERT INTO e2ee_identity (accountId, keyId, keyPair, ts, version)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(accountId, keyId) DO UPDATE SET keyPair=excluded.keyPair, ts=excluded.ts`,
      [this.accountId, identifier, serialized, ts],
    )
    return true
  }

  async isTrustedIdentity(_identifier: string, _identityKey: ArrayBuffer): Promise<boolean> {
    // Zalo PC's isTrustedIdentity always returns true (no MITM verification)
    return true
  }

  async loadPreKey(keyId: number | string): Promise<KeyPair | undefined> {
    const row = this.db
      .query<{ keyPair: string }, [string, number]>(
        `SELECT keyPair FROM e2ee_prekey WHERE accountId = ? AND keyId = ?`,
      )
      .get(this.accountId, Number(keyId))
    if (!row) return undefined
    const parsed = JSON.parse(row.keyPair)
    return {
      pubKey: fromBase64(parsed.pubKey),
      privKey: fromBase64(parsed.privKey),
    }
  }

  async storePreKey(keyId: number | string, keyPair: KeyPair): Promise<void> {
    const ts = Date.now()
    const serialized = JSON.stringify({
      pubKey: toBase64(keyPair.pubKey),
      privKey: toBase64(keyPair.privKey),
    })
    this.db.run(
      `INSERT INTO e2ee_prekey (accountId, keyId, keyPair, ts)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId, keyId) DO UPDATE SET keyPair=excluded.keyPair, ts=excluded.ts`,
      [this.accountId, Number(keyId), serialized, ts],
    )
  }

  async removePreKey(keyId: number | string): Promise<void> {
    this.db.run(`DELETE FROM e2ee_prekey WHERE accountId = ? AND keyId = ?`, [
      this.accountId,
      Number(keyId),
    ])
  }

  async loadSignedPreKey(keyId: number | string): Promise<KeyPair | undefined> {
    const row = this.db
      .query<{ keyPair: string }, [string, number]>(
        `SELECT keyPair FROM e2ee_signed_prekey WHERE accountId = ? AND keyId = ?`,
      )
      .get(this.accountId, Number(keyId))
    if (!row) return undefined
    const parsed = JSON.parse(row.keyPair)
    return {
      pubKey: fromBase64(parsed.pubKey),
      privKey: fromBase64(parsed.privKey),
    }
  }

  async storeSignedPreKey(keyId: number | string, keyPair: KeyPair): Promise<void> {
    const ts = Date.now()
    const serialized = JSON.stringify({
      pubKey: toBase64(keyPair.pubKey),
      privKey: toBase64(keyPair.privKey),
    })
    this.db.run(
      `INSERT INTO e2ee_signed_prekey (accountId, keyId, keyPair, ts)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId, keyId) DO UPDATE SET keyPair=excluded.keyPair, ts=excluded.ts`,
      [this.accountId, Number(keyId), serialized, ts],
    )
  }

  async removeSignedPreKey(keyId: number | string): Promise<void> {
    this.db.run(`DELETE FROM e2ee_signed_prekey WHERE accountId = ? AND keyId = ?`, [
      this.accountId,
      Number(keyId),
    ])
  }

  async loadSession(identifier: string): Promise<string | undefined> {
    const row = this.db
      .query<{ record: string }, [string, string]>(
        `SELECT record FROM e2ee_session WHERE accountId = ? AND identifier = ?`,
      )
      .get(this.accountId, identifier)
    return row?.record
  }

  async storeSession(identifier: string, record: string): Promise<void> {
    this.db.run(
      `INSERT INTO e2ee_session (accountId, identifier, record)
       VALUES (?, ?, ?)
       ON CONFLICT(accountId, identifier) DO UPDATE SET record=excluded.record`,
      [this.accountId, identifier, record],
    )
  }

  async removeSession(identifier: string): Promise<void> {
    this.db.run(`DELETE FROM e2ee_session WHERE accountId = ? AND identifier = ?`, [
      this.accountId,
      identifier,
    ])
  }

  async removeAllSessions(identifier: string): Promise<void> {
    this.db.run(`DELETE FROM e2ee_session WHERE accountId = ? AND identifier LIKE ?`, [
      this.accountId,
      `${identifier}%`,
    ])
  }

  async getDeciphered(key: string): Promise<string | null> {
    const row = this.db
      .query<{ content: string }, [string, string]>(
        `SELECT content FROM e2ee_deciphered WHERE accountId = ? AND key = ?`,
      )
      .get(this.accountId, key)
    return row?.content ?? null
  }

  async saveDeciphered(key: string, content: string): Promise<void> {
    this.db.run(
      `INSERT INTO e2ee_deciphered (accountId, key, content, ts)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId, key) DO UPDATE SET content=excluded.content, ts=excluded.ts`,
      [this.accountId, key, content, Date.now()],
    )
  }
}
