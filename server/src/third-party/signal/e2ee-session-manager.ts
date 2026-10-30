import { EventEmitter } from 'node:events'
import { getLibSignal, deriveIdentityKeyPair, type KeyPair, type PreKey, type SignedPreKey } from './libsignal'
import { E2EE_ON, PC_DEVICE, type E2eeMeta, type SignalSqliteStore } from './signal-store'
import { ACK_TYPE, SIGNAL_CMD, type DeviceBundle, type SessionEvent, type SignalServerManager } from './signal-server-manager'
import { toBase64, fromBase64 } from './crypto'

const OP_KEYS = 20
// REQUEST_PREKEYS types
const REQUEST_OP_KEYS = 1
const REQUEST_BUNDLE = 2
// NOTIFY_DELETE_KEY: 3 = re-init now; 0 (stale) and 1 (downgrade) drop the session until the next send
const DELETE_REINIT = 3
// PC's UPGRADING_TIMEOUT: how long a manual upgrade waits for the peer's ack before calling it pending
const UPGRADING_TIMEOUT = 10_000
// our other device slots (PC's LIST_SUBDEVICES 0 phone, 1 web, 2 PC = this client), each asked for on its own
const MY_SUBDEVICES = [0, 1]
// GET_BUNDLE errors for a device that has no usable keys (PC's bundle_err_stop_retry; -9 is the raw -9.x)
const NO_BUNDLE = new Set([-2, -3, -5, -7, -9])

// rebuild: new sessions even where one exists; forwardSubdevice: the INIT lists our other devices
type BuildOptions = { rebuild?: boolean; isReInit?: boolean; msgInfoNoti?: boolean; forwardSubdevice?: boolean }

const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

// Zalo PC's SignalProtocolManager for 1-1: this device's keys, sessions with every device of a conversation, the
// session handshake (INIT 543 -> ACK 544) and the server's session pushes. Emits ('status', uid, on) when a
// conversation's E2EE is turned on or off.
export class E2eeSessionManager extends EventEmitter {
  private building = new Map<string, Promise<E2eeMeta>>()
  // manual upgrades waiting for the peer's ACK
  private acks = new Map<string, () => void>()

  constructor(
    private accountId: string,
    private store: SignalSqliteStore,
    private rpc: SignalServerManager,
  ) {
    super()
  }

  // ===== This device's keys =====

  // GET_KEY_ID: no key on the server, or another device's key (lost local DB): publish a new bundle
  async ensureRegistered() {
    const key = await this.rpc.getKeyId()
    if (!key || key.keyId !== this.store.registrationId()) await this.submitNewBundle()
  }

  // identity from the uid as PC (SHA-256 "uid:2"), a fresh registration id, signed prekey regId+1, one-time prekeys
  // from regId+3. delSS: the server drops sessions other devices hold with the old bundle.
  async submitNewBundle() {
    const lib = getLibSignal()
    const identity: KeyPair = await deriveIdentityKeyPair(this.accountId, PC_DEVICE)
    let regId = 0
    while (!regId) regId = lib.KeyHelper.generateRegistrationId()
    await this.store.saveIdentityKeyPair(identity, regId)
    const signed: SignedPreKey = await lib.KeyHelper.generateSignedPreKey(identity, regId + 1)
    await this.store.storeSignedPreKey(signed.keyId, signed.keyPair)
    this.store.clearPreKeys()
    const opKeys = await this.newOpKeys(regId, true)
    return this.rpc.submitBundle({
      delSS: 1,
      key: {
        deviceId: PC_DEVICE,
        preKey: { iKey: { id: regId, key: toBase64(identity.pubKey) }, signature: toBase64(signed.signature), spKey: { id: signed.keyId, key: toBase64(signed.keyPair.pubKey) } },
        opKeys,
      },
    })
  }

  async replenishPreKeys() {
    const regId = this.store.registrationId()
    if (regId === null) return this.submitNewBundle()
    return this.rpc.submitPreKeys(regId, await this.newOpKeys(regId))
  }

  private async newOpKeys(regId: number, restart = false) {
    const lib = getLibSignal()
    const keys: PreKey[] = await Promise.all(this.store.nextOpIds(regId, OP_KEYS, restart).map((id) => lib.KeyHelper.generatePreKey(id)))
    for (const k of keys) await this.store.storePreKey(k.keyId, k.keyPair)
    return keys.map((k) => ({ id: k.keyId, key: toBase64(k.keyPair.pubKey) }))
  }

  // ===== Sessions =====

  private address(uid: string, deviceId: number) {
    const lib = getLibSignal()
    return new lib.SignalProtocolAddress(`${uid}_${deviceId}`, deviceId)
  }

  private cipher(uid: string, deviceId: number) {
    return new (getLibSignal().SessionCipher)(this.store, this.address(uid, deviceId))
  }

  // base64(type ‖ body); the body starts with the version byte 0x33. registrationId: the receiving device's (e2eeExt iid)
  async encrypt(uid: string, deviceId: number, plaintext: string): Promise<{ cipher: string; registrationId: number }> {
    const r = await this.cipher(uid, deviceId).encrypt(plaintext, 'utf8')
    return { cipher: Buffer.concat([Buffer.from([r.type]), Buffer.from(r.body, 'binary')]).toString('base64'), registrationId: r.registrationId }
  }

  // type 3 = PreKeyWhisperMessage (sets the session up), else WhisperMessage
  async decrypt(uid: string, deviceId: number, cipher: string): Promise<string> {
    const buf = Buffer.from(cipher, 'base64')
    if (buf.length < 2) throw new Error('Ciphertext too short')
    const c = this.cipher(uid, deviceId)
    const body = ab(buf.subarray(1))
    const plain: ArrayBuffer = buf[0] === 3 ? await c.decryptPreKeyWhisperMessage(body) : await c.decryptWhisperMessage(body)
    return Buffer.from(plain).toString('utf8')
  }

  private async sessionRegId(uid: string, deviceId: number): Promise<number | undefined> {
    if (!(await this.store.loadSession(this.address(uid, deviceId).toString()))) return undefined
    return this.cipher(uid, deviceId).getRemoteRegistrationId()
  }

  // this account's other devices (phone, web): every message also goes to them
  mySubDevices() {
    return (this.store.meta(this.accountId).devices ?? []).map((d) => d.deviceId).filter((d) => d !== PC_DEVICE)
  }

  // The devices a message to uid goes to, each with a live session. Known devices come from the E2EE list or an
  // earlier bundle; a device without a session, or whose session belongs to an older install (another regId),
  // sends us back to its bundle.
  async devices(uid: string): Promise<number[]> {
    let { devices } = this.store.meta(uid)
    const stale = async (d: { deviceId: number; regId: number }) => {
      const regId = await this.sessionRegId(uid, d.deviceId)
      return regId === undefined || (!!d.regId && regId !== d.regId)
    }
    if (!devices || (await Promise.all(devices.map(stale))).includes(true)) devices = (await this.buildSessions(uid)).devices ?? []
    return devices.map((d) => d.deviceId)
  }

  // GET_BUNDLE, then a session and an INIT (543) for each device not yet set up; one build per uid at a time
  buildSessions(uid: string, opts: BuildOptions = {}): Promise<E2eeMeta> {
    const running = this.building.get(uid)
    if (running) return running
    const build = this.build(uid, opts).finally(() => this.building.delete(uid))
    this.building.set(uid, build)
    return build
  }

  private async build(uid: string, { rebuild = false, isReInit = false, msgInfoNoti = false, forwardSubdevice = false }: BuildOptions) {
    const lib = getLibSignal()
    // ours: one device at a time as PC's _initSessionSubDevices, skipping slots without keys
    const bundles: DeviceBundle[] =
      uid === this.accountId
        ? (
            await Promise.all(
              MY_SUBDEVICES.map((deviceId) =>
                this.rpc.getBundle(uid, { deviceId, isReInit: true }).catch((e) => {
                  if (NO_BUNDLE.has((e as { code?: number }).code!)) return []
                  throw e
                }),
              ),
            )
          ).flat()
        : await this.rpc.getBundle(uid, { isReInit, msgInfoNoti })
    const devices: E2eeMeta['devices'] = []
    const inits: { deviceId: number; data: string }[] = []
    for (const b of bundles) {
      const deviceId = Number(b.deviceId)
      // a device without keys can't be written to; our own PC slot is this client
      if (!b.preKey || (uid === this.accountId && deviceId === PC_DEVICE)) continue
      const regId = Number(b.preKey.iKey.id)
      if (rebuild || (await this.sessionRegId(uid, deviceId)) !== regId) {
        const opKey = b.opKeys?.[0]
        await new lib.SessionBuilder(this.store, this.address(uid, deviceId)).processPreKey({
          registrationId: regId,
          identityKey: fromBase64(b.preKey.iKey.key),
          signedPreKey: { keyId: b.preKey.spKey.id, publicKey: fromBase64(b.preKey.spKey.key), signature: fromBase64(b.preKey.signature) },
          preKey: opKey && { keyId: opKey.id, publicKey: fromBase64(opKey.key) },
        })
        inits.push({ deviceId, data: (await this.encrypt(uid, deviceId, JSON.stringify({ subDevice: forwardSubdevice ? this.mySubDevices() : [] }))).cipher })
      }
      devices.push({ deviceId, regId })
    }
    this.store.setMeta(uid, { devices })
    if (inits.length) await this.rpc.initSession(uid, inits)
    return this.store.meta(uid)
  }

  // ===== Server session events (online pushes and the offline session queue) =====

  async onSessionEvents(cmd: number, events: SessionEvent[]) {
    for (const e of events) {
      try {
        await this.onSessionEvent(e.cmd ?? cmd, e)
      } catch (err) {
        console.error(`[e2ee] session event ${e.cmd ?? cmd}`, err)
      }
    }
  }

  private async onSessionEvent(cmd: number, e: SessionEvent) {
    const s = e.sessionData
    switch (cmd) {
      case SIGNAL_CMD.INIT_SESSION:
      case SIGNAL_CMD.INIT_SESSION_MOBILE:
        return this.onInit(e)
      case SIGNAL_CMD.ACK_INIT_SESSION:
        // the peer could not read our init: its device gets a fresh session on the next send
        if (s.type === ACK_TYPE.FAILED) return this.dropDevice(s.uidFrom, s.deviceId)
        if (s.data) await this.decrypt(s.uidFrom, s.deviceId, s.data)
        this.acks.get(s.uidFrom)?.()
        return
      case SIGNAL_CMD.REQUEST_PREKEYS:
        if (s.type === REQUEST_OP_KEYS) await this.replenishPreKeys()
        else if (s.type === REQUEST_BUNDLE) await this.submitNewBundle()
        return this.rpc.doneProcess(e, cmd)
      case SIGNAL_CMD.NOTIFY_DELETE_KEY:
        this.dropDevice(s.uidFrom, s.deviceId)
        if (s.deleteType === DELETE_REINIT) await this.buildSessions(s.uidFrom, { rebuild: true, isReInit: true })
        return this.rpc.doneProcess(e, cmd)
      case SIGNAL_CMD.DISABLE_E2EE:
        if (s.threadId) this.setStatus(s.threadId, false)
        return this.rpc.doneProcess(e, cmd)
      case SIGNAL_CMD.ENABLE_E2EE:
        if (s.data) {
          this.setStatus(s.data, true)
          await this.buildSessions(s.data, { rebuild: true, isReInit: true }).catch((err) => console.error(`[e2ee] enable ${s.data}`, err))
        }
        return this.rpc.doneProcess(e, cmd)
    }
  }

  // A device opened a session with us (PC's processInitAndAck): its PreKeyWhisperMessage carries { subDevice }. Ack
  // with our own { subDevice }, or with our iid when it can't be read; either way tell the server it's processed.
  private async onInit(e: SessionEvent) {
    const { uidFrom: uid, deviceId, data } = e.sessionData
    const ts = Number(e.sessionData.reqServerTs) || Number(e.sessionData.ts) || Date.now()
    // our own PC slot is this client
    if (uid === this.accountId && deviceId === PC_DEVICE) return this.rpc.doneProcess(e, SIGNAL_CMD.INIT_SESSION)
    try {
      if (!data || Buffer.from(data, 'base64')[0] !== 3) throw new Error('Init is not a prekey message')
      await this.decrypt(uid, deviceId, data)
      const regId = (await this.sessionRegId(uid, deviceId)) ?? 0
      this.store.setMeta(uid, { devices: [...(this.store.meta(uid).devices ?? []).filter((d) => d.deviceId !== deviceId), { deviceId, regId }] })
      if (uid !== this.accountId) this.setStatus(uid, true)
      const { cipher } = await this.encrypt(uid, deviceId, JSON.stringify({ subDevice: this.mySubDevices() }))
      await this.rpc.ackSession(uid, deviceId, ts, { data: cipher }, ACK_TYPE.SUCCESS)
    } catch (err) {
      console.error(`[e2ee] init from ${uid}-${deviceId}`, err)
      await this.rpc.ackSession(uid, deviceId, ts, { iid: this.store.registrationId() ?? 0 }, ACK_TYPE.FAILED)
    } finally {
      await this.rpc.doneProcess(e, SIGNAL_CMD.INIT_SESSION)
    }
  }

  // Zalo PC's manual upgrade (initSessionWith(uid, -1, isManualUpgrade)): new sessions with every device of uid, the
  // server told to notify the peer (msgInfoNoti), INITs listing our other devices, E2EE on. 'complete' once the peer
  // acks, 'pending' while it is away (PC: "Mã hóa hoàn tất khi … truy cập Zalo").
  async enable(uid: string, ackTimeoutMs = UPGRADING_TIMEOUT): Promise<'complete' | 'pending'> {
    await this.devices(this.accountId)
    const acked = new Promise<'complete'>((resolve) => this.acks.set(uid, () => resolve('complete')))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const { devices } = await this.buildSessions(uid, { rebuild: true, msgInfoNoti: true, forwardSubdevice: true })
      if (!devices?.length) throw Object.assign(new Error(`${uid} has no E2EE device`), { code: 'NO_DEVICE' })
      this.setStatus(uid, true)
      return await Promise.race([acked, new Promise<'pending'>((resolve) => (timer = setTimeout(() => resolve('pending'), ackTimeoutMs)))])
    } finally {
      clearTimeout(timer)
      this.acks.delete(uid)
    }
  }

  private dropDevice(uid: string, deviceId: number) {
    this.store.removeSession(this.address(uid, deviceId).toString())
    this.store.setMeta(uid, { devices: (this.store.meta(uid).devices ?? []).filter((d) => d.deviceId !== deviceId) })
  }

  private setStatus(uid: string, on: boolean) {
    if ((this.store.meta(uid).status === E2EE_ON) === on) return
    this.store.setMeta(uid, { status: on ? E2EE_ON : 0 })
    this.emit('status', uid, on)
  }

  // GET_LIST_USER_E2EE: the conversations that are end-to-end encrypted, with their devices' registration ids
  async loadE2eeList() {
    const list = await this.rpc.getE2eeList()
    const threads = (list?.threads ?? []).filter((t) => t?.uid)
    const uids = [...new Set([...threads.map((t) => String(t.uid)), ...(list?.waitUids ?? []).map(String)])].filter((u) => u !== this.accountId)
    this.store.setE2eeList(uids)
    for (const t of threads)
      if (String(t.uid) !== this.accountId && t.devices?.length && !this.store.meta(String(t.uid)).devices) this.store.setMeta(String(t.uid), { devices: t.devices.map((d) => ({ deviceId: Number(d.di), regId: Number(d.iid) })) })
    return uids
  }
}
