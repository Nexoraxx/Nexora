import { EventEmitter } from 'node:events'
import { getLibSignal, deriveIdentityKeyPair, type KeyPair, type PreKey, type SignedPreKey } from './libsignal'
import { E2EE_ON, PC_DEVICE, type E2eeDevice, type E2eeMeta, type SignalSqliteStore } from './signal-store'
import { ACK_TYPE, SIGNAL_CMD, type DeviceBundle, type SessionEvent, type SignalServerManager } from './signal-server-manager'
import { toBase64, fromBase64 } from './crypto'

const OP_KEYS = 20
// REQUEST_PREKEYS types
const REQUEST_OP_KEYS = 1
const REQUEST_BUNDLE = 2
// NOTIFY_DELETE_KEY: 3 = re-init now; 0 (new bundle) and 1 (downgrade, PC's default_11_allow_downgrade) mark the
// device stale until the next send
const DELETE_REINIT = 3
// PC's UPGRADING_TIMEOUT: how long a manual upgrade waits for the peer's ack before calling it pending
const UPGRADING_TIMEOUT = 10_000
// our other device slots (PC's LIST_SUBDEVICES 0 phone, 1 web, 2 PC = this client), each asked for on its own
const MY_SUBDEVICES = [0, 1]
// GET_BUNDLE errors for a device that has no usable keys (PC's bundle_err_stop_retry; -9 is the raw -9.x)
const NO_BUNDLE = new Set([-2, -3, -5, -7, -9])

// rebuild: new sessions even where one exists; forwardSubdevice: the INIT lists our other devices; only: these
// devices, each asked for on its own (PC's initSessionWith(uid, [ids])), the others kept
type BuildOptions = { rebuild?: boolean; isReInit?: boolean; msgInfoNoti?: boolean; forwardSubdevice?: boolean; only?: number[] }

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

  // GET_KEY_ID: no key on the server, or another device's key (lost local DB): publish a new bundle. true: a new one.
  // Zalo returns keyId as a string or a number, so compare by value as PC's loose `t != b` does — a strict `===`
  // would never match our numeric regId and would mint a fresh bundle (new iid) on every restart.
  async ensureRegistered() {
    const key = await this.rpc.getKeyId()
    const regId = this.store.registrationId()
    if (key && regId !== null && Number(key.keyId) === regId) return false
    await this.submitNewBundle()
    return true
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
    const res = await this.rpc.submitBundle({
      delSS: 1,
      key: {
        deviceId: PC_DEVICE,
        preKey: { iKey: { id: regId, key: toBase64(identity.pubKey) }, signature: toBase64(signed.signature), spKey: { id: signed.keyId, key: toBase64(signed.keyPair.pubKey) } },
        opKeys,
      },
    })
    this.store.markAllStale()
    return res
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

  // base64(type ‖ body); the body starts with the version byte 0x33. registrationId: the receiving device's (e2eeExt iid).
  // A Buffer plaintext (sticker numeric fields) is encrypted as raw bytes; a string goes in as utf8.
  async encrypt(uid: string, deviceId: number, plaintext: string | Buffer): Promise<{ cipher: string; registrationId: number }> {
    const r = Buffer.isBuffer(plaintext)
      ? await this.cipher(uid, deviceId).encrypt(ab(plaintext))
      : await this.cipher(uid, deviceId).encrypt(plaintext, 'utf8')
    return { cipher: Buffer.concat([Buffer.from([r.type]), Buffer.from(r.body, 'binary')]).toString('base64'), registrationId: r.registrationId }
  }

  // type 3 = PreKeyWhisperMessage (sets the session up), else WhisperMessage
  async decryptRaw(uid: string, deviceId: number, cipher: string): Promise<Buffer> {
    const buf = Buffer.from(cipher, 'base64')
    if (buf.length < 2) throw new Error('Ciphertext too short')
    const c = this.cipher(uid, deviceId)
    const body = ab(buf.subarray(1))
    const plain: ArrayBuffer = buf[0] === 3 ? await c.decryptPreKeyWhisperMessage(body) : await c.decryptWhisperMessage(body)
    return Buffer.from(plain)
  }

  async decrypt(uid: string, deviceId: number, cipher: string): Promise<string> {
    return (await this.decryptRaw(uid, deviceId, cipher)).toString('utf8')
  }

  private async sessionRegId(uid: string, deviceId: number): Promise<number | undefined> {
    if (!(await this.store.loadSession(this.address(uid, deviceId).toString()))) return undefined
    return this.cipher(uid, deviceId).getRemoteRegistrationId()
  }

  // this account's other devices (phone, web): every message also goes to them
  mySubDevices() {
    return (this.store.meta(this.accountId).devices ?? []).map((d) => d.deviceId).filter((d) => d !== PC_DEVICE)
  }

  // The devices a message to uid goes to, each with a live session (PC's checkSessionThenInit). Known devices come
  // from the E2EE list or an earlier bundle; a stale device, one without a session, or one whose session belongs to
  // an older install (another regId) sends us back to the bundles, as a re-init (isReInit) as PC.
  async devices(uid: string): Promise<number[]> {
    let { devices } = this.store.meta(uid)
    const stale = async (d: E2eeDevice) => {
      if (d.stale) return true
      const regId = await this.sessionRegId(uid, d.deviceId)
      return regId === undefined || (!!d.regId && regId !== d.regId)
    }
    // a peer with no known device is asked again: an empty list is never a reason to give up on an E2EE chat
    if (!devices || (!devices.length && uid !== this.accountId) || (await Promise.all(devices.map(stale))).includes(true)) devices = (await this.buildSessions(uid, { isReInit: true })).devices ?? []
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

  private async build(uid: string, { rebuild = false, isReInit = false, msgInfoNoti = false, forwardSubdevice = false, only }: BuildOptions) {
    const lib = getLibSignal()
    const known = this.store.meta(uid).devices
    // ours (Zalo refuses -1 for your own uid), or the devices asked for: one at a time as PC's _initSessionSubDevices,
    // skipping slots without keys. Zalo may refuse ours outright (112 to this client); PC carries on without them
    // then, and so does this, keeping what it knew and asking again later
    const each = uid === this.accountId ? MY_SUBDEVICES : only
    const unanswered = new Set<number>()
    const bundles: DeviceBundle[] = each
      ? (
          await Promise.all(
            each.map((deviceId) =>
              this.rpc.getBundle(uid, { deviceId, isReInit: true }).catch((e) => {
                if (!NO_BUNDLE.has((e as { code?: number }).code!)) {
                  console.error(`[e2ee] ${uid} device ${deviceId} bundle`, e)
                  unanswered.add(deviceId)
                }
                return []
              }),
            ),
          )
        ).flat()
      : await this.rpc.getBundle(uid, { isReInit, msgInfoNoti })
    // a full GET_BUNDLE lists every device; a partial one keeps the devices not asked for, or not answered
    const devices: E2eeDevice[] = each ? (known ?? []).filter((d) => !each.includes(d.deviceId) || unanswered.has(d.deviceId)) : []
    const inits: { deviceId: number; data: string }[] = []
    for (const b of bundles) {
      const deviceId = Number(b.deviceId)
      // a device without keys can't be written to; our own PC slot is this client
      if (!b.preKey || (uid === this.accountId && deviceId === PC_DEVICE)) continue
      const regId = Number(b.preKey.iKey.id)
      const wasStale = known?.find((d) => d.deviceId === deviceId)?.stale
      if (rebuild || wasStale || (await this.sessionRegId(uid, deviceId)) !== regId) {
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
    // nothing known and no answer: left unknown, asked again on the next send
    if (known || !unanswered.size) this.store.setMeta(uid, { devices })
    if (inits.length) await this.rpc.initSession(uid, inits)
    return { ...this.store.meta(uid), devices }
  }

  // ===== Server session events (online pushes and the offline session queue) =====

  // cmd SESSION_OFFLINE: the offline queue, each event naming its own cmd
  async onSessionEvents(cmd: number, events: SessionEvent[]) {
    for (const e of events) {
      try {
        await this.onSessionEvent(e.cmd ?? cmd, e, cmd === SIGNAL_CMD.SESSION_OFFLINE)
      } catch (err) {
        console.error(`[e2ee] session event ${e.cmd ?? cmd}`, err)
      }
    }
  }

  // every event is reported processed (DONE_PROCESS_SESSION) as PC does, or the server delivers it again
  private async onSessionEvent(cmd: number, e: SessionEvent, offline: boolean) {
    const s = e.sessionData
    switch (cmd) {
      case SIGNAL_CMD.INIT_SESSION:
      case SIGNAL_CMD.INIT_SESSION_MOBILE:
        return this.onInit(e)
      case SIGNAL_CMD.ACK_INIT_SESSION:
        try {
          // the peer could not read our init: its device gets a fresh session on the next send
          if (s.type === ACK_TYPE.FAILED) return this.markStale(s.uidFrom, s.deviceId)
          if (s.data) await this.decrypt(s.uidFrom, s.deviceId, s.data)
          this.acks.get(s.uidFrom)?.()
          return
        } finally {
          await this.rpc.doneProcess(e, cmd)
        }
      case SIGNAL_CMD.REQUEST_PREKEYS:
        if (s.type === REQUEST_OP_KEYS) await this.replenishPreKeys()
        // a queued bundle request is already answered by GET_KEY_ID at connect, as PC skips it
        else if (s.type === REQUEST_BUNDLE && !offline) await this.submitNewBundle()
        return this.rpc.doneProcess(e, cmd)
      case SIGNAL_CMD.NOTIFY_DELETE_KEY:
        this.markStale(s.uidFrom, s.deviceId)
        if (s.deleteType === DELETE_REINIT) await this.buildSessions(s.uidFrom, { only: [s.deviceId], rebuild: true, isReInit: true }).catch((err) => console.error(`[e2ee] re-init ${s.uidFrom}-${s.deviceId}`, err))
        return this.rpc.doneProcess(e, SIGNAL_CMD.DELETE_KEY)
      case SIGNAL_CMD.DISABLE_E2EE:
        if (s.threadId) this.setStatus(s.threadId, false)
        return this.rpc.doneProcess(e, cmd)
      case SIGNAL_CMD.ENABLE_E2EE:
        if (s.data) {
          this.setStatus(s.data, true)
          await this.buildSessions(s.data, { rebuild: true, isReInit: true }).catch((err) => {
            console.error(`[e2ee] enable ${s.data}`, err)
            // PC's rqdReinitAll: every device is fetched again on the next send
            this.store.setMeta(s.data!, { devices: null })
          })
        }
        return this.rpc.doneProcess(e, cmd)
    }
  }

  // A device opened a session with us (PC's processInitAndAck): its PreKeyWhisperMessage carries { subDevice }, the
  // sender's other devices, which get a session too. Ack with our own { subDevice }, or with our iid when it can't be
  // read; either way tell the server it's processed.
  private async onInit(e: SessionEvent) {
    const { uidFrom: uid, deviceId, data } = e.sessionData
    const ts = Number(e.sessionData.reqServerTs) || Number(e.sessionData.ts) || Date.now()
    // our own PC slot is this client
    if (uid === this.accountId && deviceId === PC_DEVICE) return this.rpc.doneProcess(e, SIGNAL_CMD.INIT_SESSION)
    let subDevice: number[] = []
    try {
      if (!data || Buffer.from(data, 'base64')[0] !== 3) throw new Error('Init is not a prekey message')
      // an init delivered again was read already (PC: MessageCounterError is a success)
      const plain = await this.decrypt(uid, deviceId, data).catch((err) => {
        if ((err as Error)?.name !== 'MessageCounterError') throw err
      })
      if (plain) subDevice = ((JSON.parse(plain) as { subDevice?: number[] })?.subDevice ?? []).map(Number).filter((d) => d !== deviceId && !(uid === this.accountId && d === PC_DEVICE))
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
    if (subDevice.length) await this.buildSessions(uid, { only: subDevice, rebuild: true, isReInit: true }).catch((err) => console.error(`[e2ee] init ${uid} devices ${subDevice}`, err))
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

  // PC's markStaleDevice: set up again on the next send; the session stays for messages still on their way
  private markStale(uid: string, deviceId: number) {
    const devices = this.store.meta(uid).devices ?? []
    const known = devices.find((d) => d.deviceId === deviceId)
    this.store.setMeta(uid, { devices: known ? devices.map((d) => (d === known ? { ...d, stale: true } : d)) : [...devices, { deviceId, regId: 0, stale: true }] })
  }

  private setStatus(uid: string, on: boolean) {
    if ((this.store.meta(uid).status === E2EE_ON) === on) return
    this.store.setMeta(uid, { status: on ? E2EE_ON : 0 })
    this.emit('status', uid, on)
  }

  // GET_LIST_USER_E2EE: the conversations that are end-to-end encrypted, with their devices' registration ids, merged
  // as PC's mergeMetaListFromServer: a listed device under another regId (or new) and one no longer listed are set up
  // again on the next send. fresh (a new bundle of ours, PC's new-device initialize): our other devices and the peers
  // waiting for this device (waitUids) get an INIT now.
  async loadE2eeList(fresh = false) {
    const reinit = (uid: string) => void this.buildSessions(uid, { rebuild: true, isReInit: true, forwardSubdevice: uid !== this.accountId }).catch((err) => console.error(`[e2ee] re-init ${uid}`, err))
    if (fresh) reinit(this.accountId)
    const list = await this.rpc.getE2eeList()
    const threads = (list?.threads ?? []).filter((t) => t?.uid)
    const waitUids = (list?.waitUids ?? []).map(String).filter((u) => u !== this.accountId)
    const uids = [...new Set([...threads.map((t) => String(t.uid)), ...waitUids])].filter((u) => u !== this.accountId)
    this.store.setE2eeList(uids)
    for (const t of threads) {
      const uid = String(t.uid)
      if (uid === this.accountId || !t.devices?.length) continue
      const known = this.store.meta(uid).devices ?? []
      const listed = t.devices.map((d) => known.find((k) => k.deviceId === Number(d.di) && k.regId === Number(d.iid)) ?? { deviceId: Number(d.di), regId: Number(d.iid) })
      const unlisted = known.filter((k) => !listed.some((d) => d.deviceId === k.deviceId)).map((k) => ({ ...k, stale: true }))
      this.store.setMeta(uid, { devices: [...listed, ...unlisted] })
    }
    if (fresh) waitUids.forEach(reinit)
    return uids
  }
}
