import type { Database } from '../../dbs/sqlite'
import type { KeyPair } from './libsignal'
import { toBase64, fromBase64 } from './crypto'

// Zalo PC's device ids; this client registers as PC
export const PC_DEVICE = 2

// e2ee_metadata row: a conversation's E2EE state and the peer's devices learnt from its bundle (regId = its iKey.id);
// devices null = never fetched
export type E2eeMeta = { status: number; devices: { deviceId: number; regId: number }[] | null }
export const E2EE_ON = 1

const serialize = (kp: KeyPair) => JSON.stringify({ pubKey: toBase64(kp.pubKey), privKey: toBase64(kp.privKey) })
const deserialize = (json: string): KeyPair => {
  const kp = JSON.parse(json)
  return { pubKey: fromBase64(kp.pubKey), privKey: fromBase64(kp.privKey) }
}

// SignalProtocolStore of the vendored libsignal (Zalo PC's build) over the e2ee_* tables
export class SignalSqliteStore {
  // libsignal reads storage.Direction when it checks identities
  readonly Direction = { SENDING: 1, RECEIVING: 2 }
  private ownKey: string

  constructor(private db: Database, private accountId: string) {
    this.ownKey = `${accountId}.${PC_DEVICE}`
  }

  async getIdentityKeyPair(): Promise<KeyPair> {
    const row = this.db.query<{ keyPair: string }, [string, string]>(`SELECT keyPair FROM e2ee_identity WHERE accountId = ? AND keyId = ?`).get(this.accountId, this.ownKey)
    if (!row) throw new Error(`No identity key for account ${this.accountId}`)
    return deserialize(row.keyPair)
  }

  async getLocalRegistrationId(): Promise<number> {
    const regId = this.registrationId()
    if (regId === null) throw new Error(`No registration id for account ${this.accountId}`)
    return regId
  }

  registrationId(): number | null {
    return this.db.query<{ regId: number }, [string, string]>(`SELECT regId FROM e2ee_registration WHERE accountId = ? AND identifier = ?`).get(this.accountId, this.ownKey)?.regId ?? null
  }

  async saveIdentityKeyPair(kp: KeyPair, regId: number): Promise<void> {
    const ts = Date.now()
    this.db.run(
      `INSERT INTO e2ee_identity (accountId, keyId, keyPair, ts, regId, version) VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT (accountId, keyId) DO UPDATE SET keyPair = excluded.keyPair, ts = excluded.ts, regId = excluded.regId`,
      [this.accountId, this.ownKey, serialize(kp), ts, regId],
    )
    this.db.run(
      `INSERT INTO e2ee_registration (accountId, identifier, regId, ts) VALUES (?, ?, ?, ?)
       ON CONFLICT (accountId, identifier) DO UPDATE SET regId = excluded.regId, ts = excluded.ts`,
      [this.accountId, this.ownKey, regId, ts],
    )
  }

  async saveIdentity(identifier: string, identityKey: ArrayBuffer): Promise<boolean> {
    this.db.run(
      `INSERT INTO e2ee_identity (accountId, keyId, keyPair, ts, version) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT (accountId, keyId) DO UPDATE SET keyPair = excluded.keyPair, ts = excluded.ts`,
      [this.accountId, identifier, JSON.stringify({ pubKey: toBase64(identityKey) }), Date.now()],
    )
    return true
  }

  // Zalo PC trusts every identity (no safety numbers): required to talk to it
  async isTrustedIdentity(): Promise<boolean> {
    return true
  }

  // ponytail: PC skips stale prekey messages by session timestamps when libsignal_control_session_state is on; undefined turns that check off
  getSessionTs(_name: string): number | undefined {
    return undefined
  }

  async loadPreKey(keyId: number | string): Promise<KeyPair | undefined> {
    const row = this.db.query<{ keyPair: string }, [string, number]>(`SELECT keyPair FROM e2ee_prekey WHERE accountId = ? AND keyId = ?`).get(this.accountId, Number(keyId))
    return row ? deserialize(row.keyPair) : undefined
  }

  async storePreKey(keyId: number | string, keyPair: KeyPair): Promise<void> {
    this.db.run(
      `INSERT INTO e2ee_prekey (accountId, keyId, keyPair, ts) VALUES (?, ?, ?, ?)
       ON CONFLICT (accountId, keyId) DO UPDATE SET keyPair = excluded.keyPair, ts = excluded.ts`,
      [this.accountId, Number(keyId), serialize(keyPair), Date.now()],
    )
  }

  async removePreKey(keyId: number | string): Promise<void> {
    this.db.run(`DELETE FROM e2ee_prekey WHERE accountId = ? AND keyId = ?`, [this.accountId, Number(keyId)])
  }

  async loadSignedPreKey(keyId: number | string): Promise<KeyPair | undefined> {
    const row = this.db.query<{ keyPair: string }, [string, number]>(`SELECT keyPair FROM e2ee_signed_prekey WHERE accountId = ? AND keyId = ?`).get(this.accountId, Number(keyId))
    return row ? deserialize(row.keyPair) : undefined
  }

  async storeSignedPreKey(keyId: number | string, keyPair: KeyPair): Promise<void> {
    this.db.run(
      `INSERT INTO e2ee_signed_prekey (accountId, keyId, keyPair, ts) VALUES (?, ?, ?, ?)
       ON CONFLICT (accountId, keyId) DO UPDATE SET keyPair = excluded.keyPair, ts = excluded.ts`,
      [this.accountId, Number(keyId), serialize(keyPair), Date.now()],
    )
  }

  // a new bundle drops the old one-time prekeys (PC's removeAllOldPreKey); signed prekeys stay for messages in flight
  clearPreKeys() {
    this.db.run(`DELETE FROM e2ee_prekey WHERE accountId = ?`, [this.accountId])
  }

  // one-time prekey ids continue from the last one handed out (PC's _currentOpId), so a refill never reuses a published id
  nextOpIds(regId: number, count: number, restart = false): number[] {
    const key = 'e2ee_op_id'
    const last = restart ? 0 : Number(this.db.query<{ val: string }, [string, string]>(`SELECT val FROM kv WHERE accountId = ? AND key = ?`).get(this.accountId, key)?.val ?? 0)
    this.db.run(`INSERT INTO kv (accountId, key, val) VALUES (?, ?, ?) ON CONFLICT (accountId, key) DO UPDATE SET val = excluded.val`, [this.accountId, key, String(last + count)])
    return Array.from({ length: count }, (_, i) => regId + 2 + last + i + 1)
  }

  async loadSession(identifier: string): Promise<string | undefined> {
    return this.db.query<{ record: string }, [string, string]>(`SELECT record FROM e2ee_session WHERE accountId = ? AND identifier = ?`).get(this.accountId, identifier)?.record
  }

  async storeSession(identifier: string, record: string): Promise<void> {
    this.db.run(
      `INSERT INTO e2ee_session (accountId, identifier, record) VALUES (?, ?, ?) ON CONFLICT (accountId, identifier) DO UPDATE SET record = excluded.record`,
      [this.accountId, identifier, record],
    )
  }

  removeSession(identifier: string) {
    this.db.run(`DELETE FROM e2ee_session WHERE accountId = ? AND identifier = ?`, [this.accountId, identifier])
  }

  meta(uid: string): E2eeMeta {
    const row = this.db.query<{ status: number | null; devices: string | null }, [string, string]>(`SELECT status, devices FROM e2ee_metadata WHERE accountId = ? AND uid = ?`).get(this.accountId, uid)
    return { status: row?.status ?? 0, devices: row?.devices ? JSON.parse(row.devices) : null }
  }

  setMeta(uid: string, patch: Partial<E2eeMeta>) {
    const next = { ...this.meta(uid), ...patch }
    this.db.run(
      `INSERT INTO e2ee_metadata (accountId, uid, status, devices) VALUES (?, ?, ?, ?)
       ON CONFLICT (accountId, uid) DO UPDATE SET status = excluded.status, devices = excluded.devices`,
      [this.accountId, uid, next.status, next.devices && JSON.stringify(next.devices)],
    )
  }

  // conversations Zalo lists as end-to-end encrypted (GET_LIST_USER_E2EE); every other one is off
  setE2eeList(uids: string[]) {
    this.db.transaction(() => {
      this.db.run(`UPDATE e2ee_metadata SET status = 0 WHERE accountId = ?`, [this.accountId])
      for (const uid of uids) this.setMeta(uid, { status: E2EE_ON })
    })()
  }

  async getDeciphered(key: string): Promise<string | null> {
    return this.db.query<{ content: string }, [string, string]>(`SELECT content FROM e2ee_deciphered WHERE accountId = ? AND key = ?`).get(this.accountId, key)?.content ?? null
  }

  async saveDeciphered(key: string, content: string): Promise<void> {
    this.db.run(
      `INSERT INTO e2ee_deciphered (accountId, key, content, ts) VALUES (?, ?, ?, ?) ON CONFLICT (accountId, key) DO UPDATE SET content = excluded.content, ts = excluded.ts`,
      [this.accountId, key, content, Date.now()],
    )
  }
}
