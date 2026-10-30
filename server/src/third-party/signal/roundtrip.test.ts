import { expect, test } from 'bun:test'
import type { API } from '@hwqnq/zca-js'
import { openDatabase, type Database } from '../../dbs/sqlite'
import { SignalSqliteStore } from './signal-store'
import { E2eeSessionManager } from './e2ee-session-manager'
import { E2eeMessageSender } from './e2ee-message-sender'
import { E2eeMessageReceiver, E2EE_STATUS } from './e2ee-message-receiver'
import { SignalServerManager, type BundleKey, type DeviceBundle, type E2eeList, type SessionEvent } from './signal-server-manager'

type Call = { uid: string; cmd: number; subCmd: number; data: Record<string, any> }
const UNKNOWN_EXCEPTION = Symbol('112')

// Zalo's signal server as far as these tests need it: bundles per (uid, device), one one-time prekey handed out per
// GET_BUNDLE, replies in PC's envelope { error_code, data: JSON { error_code, data: { reqId, data } }, encrypt: 0 }.
// As the live server: a GET_BUNDLE of your own uid for every device (-1) fails with 112 and no reqId; your own
// devices are asked one by one, -2 for one without keys.
class FakeZalo {
  bundles = new Map<string, Map<number, DeviceBundle & { opKeys: BundleKey[] }>>()
  calls: Call[] = []
  list: E2eeList = {}
  // as the live server answered this client: 112 for any GET_BUNDLE of your own devices
  refuseOwn = false

  connect(uid: string, deviceId: number) {
    const rpc = new SignalServerManager((cmd, subCmd, body) => {
      const { reqId, data } = body as { reqId: string; data: Record<string, any> }
      this.calls.push({ uid, cmd, subCmd, data })
      const reply = this.handle(uid, deviceId, cmd, data)
      const frame = reply === UNKNOWN_EXCEPTION ? { error_code: 112, encrypt: 0, data: JSON.stringify({ error_code: 112, error_message: 'Lỗi không xác định' }) } : { error_code: 0, encrypt: 0, data: JSON.stringify({ error_code: 0, data: { reqId, data: reply } }) }
      queueMicrotask(() => void rpc.onFrame(cmd, subCmd, frame))
    })
    return rpc
  }

  private handle(uid: string, deviceId: number, cmd: number, d: Record<string, any>) {
    const own = this.bundles.get(uid) ?? new Map()
    this.bundles.set(uid, own)
    switch (cmd) {
      case 564:
        return own.get(deviceId) ? { keyId: own.get(deviceId)!.preKey!.iKey.id } : { err: -1 }
      case 540:
        own.set(deviceId, { deviceId, preKey: d.key.preKey, opKeys: [...d.key.opKeys] })
        return { ts: 1 }
      case 542:
        own.get(deviceId)!.opKeys.push(...d.opKeys)
        return { ts: 1 }
      case 541: {
        const of = String(d.uids[0].uid)
        const wanted: number = d.uids[0].deviceId
        if (of === uid && (wanted === -1 || this.refuseOwn)) return UNKNOWN_EXCEPTION
        const devices = [...(this.bundles.get(of)?.values() ?? [])].filter((b) => wanted === -1 || b.deviceId === wanted)
        if (wanted !== -1 && !devices.some((b) => b.preKey)) return { err: -2 }
        return { keys: [{ uid: of, keys: devices.map((b) => ({ ...b, opKeys: b.opKeys.splice(0, 1) })) }] }
      }
      case 563:
        return this.list
      default:
        return {}
    }
  }

  sent(cmd: number) {
    return this.calls.filter((c) => c.cmd === cmd)
  }
}

const account = (db: Database, id: string) => db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES (?, ?, 'i', '{}', 'ua', 1)`, [id, id])

// one Signal stack: an account's device on the fake server
const device = (zalo: FakeZalo, db: Database, uid: string, deviceId = 2) => {
  const store = new SignalSqliteStore(db, uid)
  const sessions = new E2eeSessionManager(uid, store, zalo.connect(uid, deviceId))
  return { store, sessions, receiver: new E2eeMessageReceiver(store, sessions), sender: new E2eeMessageSender(uid, store, sessions) }
}

// zaloPost through a fake zca API: what the E2EE send POSTed
const fakeApi = () => {
  const posted: Record<string, any>[] = []
  const api = {
    zpwServiceMap: { chat_e2e: ['https://e2e'] },
    custom: (name: string, cb: (p: unknown) => unknown) =>
      Object.assign(api, {
        [name]: (props: unknown) =>
          cb({
            props,
            utils: {
              encodeAES: (s: string) => s,
              makeURL: (u: string) => u,
              request: async (url: string, init: { body: URLSearchParams }) => posted.push({ url, ...JSON.parse(init.body.get('params')!) }),
              resolve: async () => ({ msgId: 777 }),
            },
          }),
      }),
  }
  return { api: api as unknown as API, posted }
}

const setup = async () => {
  const zalo = new FakeZalo()
  const db = openDatabase(':memory:')
  for (const id of ['alice', 'bob']) account(db, id)
  const alice = device(zalo, db, 'alice')
  const bob = device(zalo, db, 'bob')
  await alice.sessions.ensureRegistered()
  await bob.sessions.ensureRegistered()
  return { zalo, db, alice, bob }
}

const incoming = (cliMsgId: string, uidFrom: string, content: unknown, deviceId = 2, extra: object = {}) => ({ cliMsgId, uidFrom, msgType: 'webchat', content, paramsExt: { platformType: deviceId }, ...extra })

test('alice writes to bob from his published bundle: the prekey message and later ones decrypt, a redelivery comes from the cache', async () => {
  const { alice, bob } = await setup()
  expect(await alice.sessions.devices('bob')).toEqual([2])
  const first = await alice.sessions.encrypt('bob', 2, 'xin chào')
  expect(Buffer.from(first.cipher, 'base64')[0]).toBe(3)
  expect(await bob.receiver.decrypt(incoming('1', 'alice', first.cipher), false)).toEqual({ status: E2EE_STATUS.OK, content: 'xin chào' })

  const second = await alice.sessions.encrypt('bob', 2, 'lần hai 👋')
  expect(await bob.receiver.decrypt(incoming('2', 'alice', second.cipher), false)).toEqual({ status: E2EE_STATUS.OK, content: 'lần hai 👋' })
  expect(await bob.receiver.decrypt(incoming('2', 'alice', second.cipher), false)).toEqual({ status: E2EE_STATUS.OK, content: 'lần hai 👋' })
})

test("INIT carries a single 0x33 version byte; bob decrypts it, acks with a message alice can read, and reports it processed", async () => {
  const { zalo, alice, bob } = await setup()
  await alice.sessions.devices('bob')
  const [init] = zalo.sent(543)
  expect(init.data).toMatchObject({ type: 1, uidTo: 'bob' })
  const cipher = Buffer.from(init.data.data[0].data, 'base64')
  expect([...cipher.subarray(0, 3)]).not.toEqual([3, 0x33, 0x33])
  expect([cipher[0], cipher[1]]).toEqual([3, 0x33])

  const event: SessionEvent = { msgId: '900', sessionData: { uidFrom: 'alice', uidTo: 'bob', deviceId: 2, data: init.data.data[0].data, ts: 5 } }
  await bob.sessions.onSessionEvents(543, [event])
  const [ack] = zalo.sent(544)
  expect(ack.data).toMatchObject({ type: 1, uidTo: 'alice', data: [{ deviceId: 2, ts: 5 }] })
  expect(JSON.parse(await alice.sessions.decrypt('bob', 2, ack.data.data[0].data))).toEqual({ subDevice: [] })
  expect(zalo.sent(545)).toEqual([{ uid: 'bob', cmd: 545, subCmd: 1, data: { queueName: '', info: [{ gid: '900', cmd: 543, subCmd: 0, sid: 'alice', deviceId: 2 }] } }])
  expect(bob.store.meta('alice').status).toBe(1)
})

test('an unreadable INIT is acked as failed with our iid, and still reported processed', async () => {
  const { zalo, bob } = await setup()
  await bob.sessions.onSessionEvents(543, [{ msgId: '1', sessionData: { uidFrom: 'carol', deviceId: 0, data: Buffer.from([3, 0x33, 1, 2]).toString('base64') } }])
  expect(zalo.sent(544)[0].data).toMatchObject({ type: 0, uidTo: 'carol', data: [{ deviceId: 0, iid: bob.store.registrationId() }] })
  expect(zalo.sent(545)).toHaveLength(1)
})

test('a text goes to every device of the peer and our other devices, each with its own iid; the bundle is fetched once', async () => {
  const { zalo, alice, bob } = await setup()
  // bob's phone (device 0) and alice's phone, each a separate Signal stack; bob's web (1) has no keys
  const phoneDb = (uid: string) => {
    const db = openDatabase(':memory:')
    account(db, uid)
    return db
  }
  const bobPhone = device(zalo, phoneDb('bob'), 'bob', 0)
  await bobPhone.sessions.submitNewBundle()
  const alicePhone = device(zalo, phoneDb('alice'), 'alice', 0)
  await alicePhone.sessions.submitNewBundle()
  zalo.bundles.get('bob')!.set(1, { deviceId: 1, opKeys: [] })

  const { api, posted } = fakeApi()
  const sent = await alice.sender.sendText(api, 'bob', 'đậm', [{ start: 0, len: 3, st: 'b' }])
  expect(sent).toMatchObject({ msgId: '777', content: { action: 'rtf', title: 'đậm' } })
  expect(posted[0]).toMatchObject({ url: 'https://e2e/api/e2ee/pc/message/sms', destType: 3, threadId: 'bob', clientId: sent.cliMsgId })
  const params: Record<string, string | number>[] = JSON.parse(posted[0].listParams)
  expect(params.map((p) => [p.toId, p.platform])).toEqual([
    ['bob', 2],
    ['bob', 0],
    ['alice', 0],
  ])
  const ext = params.map((p) => JSON.parse(String(p.e2eeExt)))
  expect(ext[0]).toEqual({ version: 0, compat_version: 0, sender_iid: alice.store.registrationId()!, iid: bob.store.registrationId()! })
  expect(ext[1].iid).toBe(bobPhone.store.registrationId()!)
  expect(ext[2].iid).toBe(alicePhone.store.registrationId()!)

  const forPhone = await bobPhone.receiver.decrypt(incoming(sent.cliMsgId, 'alice', { action: 'rtf', title: params[1].message, params: params[1].textProperties }), false)
  expect(forPhone).toEqual({ status: E2EE_STATUS.OK, content: { action: 'rtf', title: 'đậm', params: JSON.stringify({ styles: [{ start: 0, len: 3, st: 'b' }], ver: 0 }) } })
  // alice's own phone gets the copy meant for it
  expect(await alicePhone.sessions.decrypt('alice', 2, String(params[2].message))).toBe('đậm')

  await alice.sender.sendText(api, 'bob', 'lần hai')
  expect(zalo.sent(541).filter((c) => c.uid === 'alice' && c.data.uids[0].uid === 'bob')).toHaveLength(1)
})

test("the server's copy of our own send reads from what we sent; a message for an older bundle is not decrypted", async () => {
  const { alice, bob } = await setup()
  const { api } = fakeApi()
  const sent = await alice.sender.sendText(api, 'bob', 'của tôi')
  expect(await alice.receiver.decrypt(incoming(sent.cliMsgId, 'alice', 'whatever'), true)).toEqual({ status: E2EE_STATUS.OK, content: 'của tôi' })
  expect(await alice.receiver.decrypt(incoming('other', 'alice', 'whatever'), true)).toEqual({ status: E2EE_STATUS.DUPLICATED })

  const { cipher } = await alice.sessions.encrypt('bob', 2, 'cũ')
  expect(await bob.receiver.decrypt(incoming('9', 'alice', cipher, 2, { e2ee: JSON.stringify({ iid: 1 }) }), false)).toEqual({ status: E2EE_STATUS.CHANGE_DEVICE })
  expect(await bob.receiver.decrypt(incoming('9', 'alice', cipher, 2, { e2ee: JSON.stringify({ compat_version: 1 }) }), false)).toEqual({ status: E2EE_STATUS.FAILED })
  expect(await bob.receiver.decrypt(incoming('9', 'alice', 'not a cipher'), false)).toEqual({ status: E2EE_STATUS.FAILED })
})

test("a reply's quoted text decrypts with the message, in PC's field order", async () => {
  const { alice, bob } = await setup()
  await alice.sessions.devices('bob')
  const enc = async (s: string) => (await alice.sessions.encrypt('bob', 2, s)).cipher
  const content = await enc('trả lời')
  const quote = { ownerId: 'bob', msg: await enc('gốc'), fromD: await enc('Bob'), attach: '' }
  expect(await bob.receiver.decrypt({ ...incoming('3', 'alice', content), quote }, false)).toEqual({ status: E2EE_STATUS.OK, content: 'trả lời', quote: { ownerId: 'bob', msg: 'gốc', fromD: 'Bob', attach: '' } })
})

test('one-time prekey ids continue after a restart instead of overwriting published ones', async () => {
  const { zalo, db, bob } = await setup()
  const regId = bob.store.registrationId()!
  const published = zalo.sent(540).find((c) => c.uid === 'bob')!.data.key.opKeys.map((k: BundleKey) => k.id)
  expect(published).toEqual(Array.from({ length: 20 }, (_, i) => regId + 3 + i))
  // a new process: REQUEST_PREKEYS (type 1) asks for more
  const restarted = device(zalo, db, 'bob')
  await restarted.sessions.onSessionEvents(549, [{ msgId: '7', sessionData: { uidFrom: 'bob', deviceId: 2, type: 1 } }])
  const refill = zalo.sent(542)[0].data
  expect(refill).toMatchObject({ deviceId: 2, id: regId })
  expect(refill.opKeys.map((k: BundleKey) => k.id)).toEqual(Array.from({ length: 20 }, (_, i) => regId + 23 + i))
  expect(zalo.sent(545).at(-1)!.data.info[0]).toMatchObject({ gid: '7', cmd: 549 })
})

test('GET_KEY_ID: a matching key is kept, a missing or foreign one is replaced', async () => {
  const { zalo, bob } = await setup()
  const before = bob.store.registrationId()
  await bob.sessions.ensureRegistered()
  expect(bob.store.registrationId()).toBe(before)
  expect(zalo.sent(540).filter((c) => c.uid === 'bob')).toHaveLength(1)
  zalo.bundles.get('bob')!.get(2)!.preKey!.iKey.id = 1
  await bob.sessions.ensureRegistered()
  expect(zalo.sent(540).filter((c) => c.uid === 'bob')).toHaveLength(2)
})

test('E2EE list, enable, disable and delete-key pushes keep the conversation state and sessions', async () => {
  const { zalo, alice, bob } = await setup()
  zalo.list = { threads: [{ uid: 'bob', devices: [{ di: 2, iid: bob.store.registrationId()! }] }], waitUids: ['carol'] }
  alice.store.setMeta('dave', { status: 1 })
  const changed: string[] = []
  alice.sessions.on('status', (uid: string, on: boolean) => changed.push(`${uid}:${on}`))
  await alice.sessions.loadE2eeList()
  expect([alice.store.meta('bob').status, alice.store.meta('carol').status, alice.store.meta('dave').status]).toEqual([1, 1, 0])

  await alice.sessions.onSessionEvents(580, [{ msgId: '1', sessionData: { uidFrom: 'bob', deviceId: 0, threadId: 'bob' } }])
  expect(alice.store.meta('bob').status).toBe(0)
  await alice.sessions.onSessionEvents(581, [{ msgId: '2', sessionData: { uidFrom: 'bob', deviceId: 0, data: 'bob' } as SessionEvent['sessionData'] }])
  expect(alice.store.meta('bob').status).toBe(1)
  expect(changed).toEqual(['bob:false', 'bob:true'])

  await alice.sessions.devices('bob')
  await alice.sessions.onSessionEvents(548, [{ msgId: '3', sessionData: { uidFrom: 'bob', deviceId: 2, deleteType: 0 } }])
  expect(await alice.store.loadSession('bob_2.2')).toBeUndefined()
  expect(zalo.sent(545).map((c) => c.data.info[0].cmd)).toEqual([580, 581, 548])
})

test('turning E2EE on (PC\'s manual upgrade): every device of the peer gets an INIT listing our other devices; complete once acked, pending until then', async () => {
  const { zalo, db, alice, bob } = await setup()
  const alicePhoneDb = openDatabase(':memory:')
  account(alicePhoneDb, 'alice')
  await device(zalo, alicePhoneDb, 'alice', 0).sessions.submitNewBundle()

  // bob is away: no ack in time
  expect(await alice.sessions.enable('bob', 50)).toBe('pending')
  expect(alice.store.meta('bob').status).toBe(1)
  const bundleReq = zalo.sent(541).find((c) => c.uid === 'alice' && c.data.uids[0].uid === 'bob')!
  expect(bundleReq.data).toMatchObject({ isReInit: 0, msgInfoNoti: 1 })
  const init = zalo.sent(543).find((c) => c.data.uidTo === 'bob')!
  expect(init.data.type).toBe(1)
  expect(JSON.parse(await bob.sessions.decrypt('alice', 2, init.data.data[0].data))).toEqual({ subDevice: [0] })

  // carol is online: she acks while we wait
  account(db, 'carol')
  const carol = device(zalo, db, 'carol')
  await carol.sessions.ensureRegistered()
  const enabling = alice.sessions.enable('carol', 5_000)
  while (!zalo.sent(543).some((c) => c.data.uidTo === 'carol')) await Bun.sleep(5)
  const toCarol = zalo.sent(543).find((c) => c.data.uidTo === 'carol')!
  await carol.sessions.onSessionEvents(543, [{ msgId: '2', sessionData: { uidFrom: 'alice', deviceId: 2, data: toCarol.data.data[0].data } }])
  expect(carol.store.meta('alice').status).toBe(1)
  const ack = zalo.sent(544).find((c) => c.uid === 'carol')!
  await alice.sessions.onSessionEvents(544, [{ msgId: '3', sessionData: { uidFrom: 'carol', deviceId: 2, type: 1, data: ack.data.data[0].data } }])
  expect(await enabling).toBe('complete')
})

test('turning E2EE on fails for a peer with no E2EE device', async () => {
  const { alice } = await setup()
  await expect(alice.sessions.enable('nobody', 50)).rejects.toMatchObject({ code: 'NO_DEVICE' })
  expect(alice.store.meta('nobody').status).toBe(0)
})

test("when Zalo refuses our own devices' bundles, turning E2EE on and sending still work, as PC, and ours are asked again later", async () => {
  const { zalo, alice, bob } = await setup()
  zalo.refuseOwn = true
  expect(await alice.sessions.enable('bob', 50)).toBe('pending')
  expect(zalo.sent(543).find((c) => c.data.uidTo === 'bob')).toBeDefined()
  const { api, posted } = fakeApi()
  await alice.sender.sendText(api, 'bob', 'vẫn gửi được')
  expect(JSON.parse(posted[0].listParams).map((p: { toId: string }) => p.toId)).toEqual(['bob'])
  expect(alice.store.meta('alice').devices).toBeNull()
  zalo.refuseOwn = false
  await alice.sender.sendText(api, 'bob', 'lần sau')
  expect(alice.store.meta('alice').devices).toEqual([])
  expect(bob.store.registrationId()).toBeTruthy()
})
