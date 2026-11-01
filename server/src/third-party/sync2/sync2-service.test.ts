import { afterEach, expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { zstdCompressSync } from 'node:zlib'
import type { Message } from '@hwqnq/zca-js'
import { openDatabase } from '../../dbs/sqlite'
import type { ZcaService } from '../zalo/zalo-client'
import { Sync2Service, SYNC_CMD } from './sync2-service'
import { createMetadata, encryptMessage, generateKeyPair, initZproto } from './zproto'

// ===== a tiny proto3 writer for the phone's chunks: zero values are left off the wire, as the phone's encoder does =====
const varint = (v: number | bigint) => {
  const out: number[] = []
  let n = BigInt(v)
  do {
    out.push(Number(n & 0x7fn) | (n > 0x7fn ? 0x80 : 0))
    n >>= 7n
  } while (n > 0n)
  return out
}
const num = (f: number, v: number | bigint) => (BigInt(v) === 0n ? [] : [...varint(f << 3), ...varint(v)])
const bytes = (f: number, b: number[] | Uint8Array) => [...varint((f << 3) | 2), ...varint(b.length), ...b]
const str = (f: number, s: string) => (s ? bytes(f, [...new TextEncoder().encode(s)]) : [])
const mention = (uid: string, pos: number, len: number) => bytes(2, [...str(1, uid), ...num(2, pos), ...num(3, len)])
const quote = (owner: string, globalMsgId: bigint) => bytes(4, [...str(2, owner), ...num(6, globalMsgId)])
const msg = (o: { sender: string; id: number; type?: number; ts: number; content?: string; status?: number; meta?: number[] }) => [
  ...str(1, o.sender), ...num(2, o.id + 1000), ...num(3, o.status ?? 4), ...num(4, o.type ?? 0), ...num(5, o.ts), ...num(6, o.id), ...str(7, o.content ?? ''),
  ...(o.meta ? bytes(8, o.meta) : []),
]
const messageChunk = (partitions: [string, number[][]][]) => new Uint8Array([...num(1, 1), ...partitions.flatMap(([id, ms]) => bytes(2, [...str(1, id), ...ms.flatMap((m) => bytes(2, m))]))])
const convChunk = (convs: [string, number][]) => new Uint8Array([...num(1, 1), ...convs.flatMap(([id, type]) => bytes(2, [...str(1, id), ...num(2, type), ...num(4, 1_700_000_000_000)]))])
const framed = (...chunks: Uint8Array[]) => Buffer.concat(chunks.flatMap((c) => [Buffer.from(new Uint32Array([c.length]).buffer), Buffer.from(c)]))

const ME = 'me'
const until = async (f: () => boolean) => {
  for (let i = 0; i < 400 && !f(); i++) await Bun.sleep(5)
}
const realFetch = globalThis.fetch
afterEach(() => void (globalThis.fetch = realFetch))

const setup = async ({ authed = true, reply = true, enabled = true } = {}) => {
  await initZproto()
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  db.run(`INSERT INTO user (accountId, userId, globalId) VALUES ('me', 'me', 'G_ME'), ('me', 'u1', 'G_U1'), ('me', 'u2', 'G_U2')`)
  db.run(`INSERT INTO groups (accountId, userId, globalId) VALUES ('me', 'g1', 'G_G1')`)
  // the chat socket: frames out are captured, replies are pushed back in as the server would
  const sent: { cmd: number; body: { reqId: string; data: Record<string, any> } }[] = []
  const ws = Object.assign(new EventEmitter(), {
    readyState: 1,
    OPEN: 1,
    send: (buf: Buffer) => {
      const cmd = buf.readUInt16LE(1)
      const body = JSON.parse(buf.subarray(4).toString())
      sent.push({ cmd, body })
      if (!reply) return
      const answer = JSON.stringify({ error_code: 0, data: JSON.stringify({ error_code: 0, data: { reqId: body.reqId } }), encrypt: 0 })
      queueMicrotask(() => ws.emit('message', Buffer.concat([Buffer.from([1, cmd & 0xff, cmd >> 8, 0]), Buffer.from(answer)])))
    },
  })
  const listener = Object.assign(new EventEmitter(), { ws })
  const zca = new EventEmitter() as unknown as ZcaService
  const api = { listener, zpwServiceMap: {}, getContext: () => ({ settings: { features: enabled ? { sync_2_pc: { enable: true } } : {} } }) }
  Object.assign(zca, { get: () => api })
  const sync = new Sync2Service(db, zca)
  zca.emit('attached', ME, api as never)
  listener.emit('connected')
  if (authed) zca.emit('ready', ME)
  const imported: { msgs: Message[]; readUpTo: Map<string, string> }[] = []
  sync.on('messages', (_, msgs, readUpTo) => imported.push({ msgs, readUpTo }))
  return { sync, zca, sent, imported, listener }
}

// the phone: answers a REQUEST with a confirmed status, the metadata batch (encrypted to the PC's ik/ek; it only
// carries the session record) and the data batches under that record — announced metadata-last when asked, as
// batches can arrive out of order
const answer = (zca: ZcaService, req: { data: Record<string, any> }, files: Map<string, Buffer>, chunks: Uint8Array[], { metaLast = false, failIdx = -1 } = {}) => {
  const { syncId, ik, ek } = req.data
  const meta = createMetadata(zstdCompressSync(new Uint8Array()), generateKeyPair(), Buffer.from(ik, 'base64'), Buffer.from(ek, 'base64'))
  const control = (act: string, data: object) => zca.emit('control', ME, { act_type: 'transfer_sync2', act, data: JSON.stringify(data) })
  control('transfer_status', { syncId, status: 3, fromDevice: 0 })
  control('transfer_status', { syncId, status: 4, fromDevice: 0 })
  const ciphers = [meta.ciphertext, ...chunks.map((c) => encryptMessage(meta.sessionRecord, zstdCompressSync(c)))]
  const order = ciphers.map((_, i) => i)
  if (metaLast) order.push(order.shift()!)
  for (const idx of order) {
    const msgUrl = `https://f/${syncId}/${idx}`
    files.set(msgUrl, framed(ciphers[idx]))
    const batch = { syncId, idx, isLast: idx === ciphers.length - 1, batchType: idx ? 1 : 2, msgUrl, scopes: [{ partition: '' }] }
    if (idx === failIdx) control('transfer_error', { ...batch, errorCode: 702 })
    else control('upload_batch', { ...batch, err: 0 })
  }
}
const serve = (files: Map<string, Buffer>) =>
  (globalThis.fetch = mock(async (url: string | URL | Request) => new Response(new Uint8Array(files.get(String(url))!))) as unknown as typeof fetch)

test('sync from the phone: conversation list, then messages, decrypted, mapped to local ids and read state', async () => {
  const { sync, zca, sent, imported } = await setup()
  const files = new Map<string, Buffer>()
  serve(files)

  expect(sync.start(ME).state).toBe('waiting_confirm')
  await Bun.sleep(10)
  const convReq = sent.find((s) => s.cmd === SYNC_CMD.REQUEST)!
  expect(convReq.body.reqId).toMatch(/^req_\d+$/)
  expect(convReq.body.data.syncId).toMatch(/^[A-Za-z0-9]{32}$/)
  expect(convReq.body.data).toMatchObject({ syncType: 0, toDevice: 0, tempKey: '', ver: 1, ussidx: 0, req: { type: 'conversation', priority: 0, batchSize: 2000, queries: [{ partition: '', from: 0, to: Number.MAX_SAFE_INTEGER, limit: 2147483647 }] } })
  answer(zca, convReq.body, files, [convChunk([['G_U1', 1], ['G_G1', 2], ['G_UNKNOWN_GROUP', 2]])])
  await Bun.sleep(30)

  const msgReq = sent.filter((s) => s.cmd === SYNC_CMD.REQUEST)[1]
  expect(msgReq.body.data).toMatchObject({ ussidx: 1, req: { type: 'message' } })
  expect(msgReq.body.data.req.queries).toEqual([
    { partition: 'oneone/G_U1', from: 0, to: 1_700_000_000_000, limit: 100 },
    { partition: 'group/G_G1', from: 0, to: 1_700_000_000_000, limit: 100 },
  ])
  expect(msgReq.body.data.ik).toBe(convReq.body.data.ik)
  // the conversation session stays open while messages are asked for
  expect(sent.filter((s) => s.cmd === SYNC_CMD.DISPOSE)).toEqual([])
  const photo = bytes(1, [...str(1, 'photo'), ...str(5, 'ảnh'), ...str(6, 'https://img/1.jpg'), ...num(11, 1)])
  answer(
    zca,
    msgReq.body,
    files,
    [
      // text: msgType 0 is not on the wire
      messageChunk([['oneone/G_U1', [msg({ sender: 'G_U1', id: 101, ts: 1001, content: 'chào', status: 5 }), msg({ sender: 'G_ME', id: 102, type: 3, ts: 1002, meta: photo })]]]),
      messageChunk([
        ['oneone/G_U1', [msg({ sender: 'G_U1', id: 103, ts: 1003, content: 'chưa đọc', meta: quote('G_ME', 102n) })]],
        ['group/G_G1', [msg({ sender: 'G_U2', id: 201, ts: 2001, content: '@u1 nhóm', status: 5, meta: mention('G_U1', 0, 3) }), msg({ sender: 'G_U2', id: 202, type: 36, ts: 2002 })]],
      ]),
    ],
    { metaLast: true },
  )
  await until(() => ['done', 'error'].includes(sync.status(ME)!.state))

  expect(sync.status(ME)).toMatchObject({ state: 'done', progress: 100, conversations: 2, messages: 4 })
  const msgs = imported.flatMap((i) => i.msgs)
  expect(msgs.map((m) => [m.threadId, m.data.msgId, m.data.uidFrom, m.isSelf, m.data.msgType, m.data.ts])).toEqual([
    ['u1', '101', 'u1', false, 'webchat', '1001'],
    ['u1', '102', ME, true, 'chat.photo', '1002'],
    ['u1', '103', 'u1', false, 'webchat', '1003'],
    ['g1', '201', 'u2', false, 'webchat', '2001'],
  ])
  expect(msgs[0].data.content).toBe('chào')
  expect(msgs[1].data.content).toMatchObject({ title: 'ảnh', href: 'https://img/1.jpg', childnumber: 0 })
  expect(msgs[2].data.quote).toMatchObject({ ownerId: ME, globalMsgId: '102' })
  expect((msgs[3].data as { mentions?: unknown }).mentions).toEqual([{ uid: 'u1', pos: 0, len: 3, type: 0 }])
  // read up to the newest message seen on the phone or sent from this account, per batch
  expect(imported.map((i) => Object.fromEntries(i.readUpTo))).toEqual([{ u1: '102' }, { g1: '201' }])
  // both sessions disposed as successful, at the end
  expect(sent.filter((s) => s.cmd === SYNC_CMD.DISPOSE).map((s) => s.body.data.reason)).toEqual([1, 1])
})

test('a batch the phone failed costs only its own rows', async () => {
  const { sync, zca, sent, imported } = await setup()
  const files = new Map<string, Buffer>()
  serve(files)
  sync.start(ME)
  await Bun.sleep(10)
  answer(zca, sent[0].body, files, [convChunk([['G_U1', 1]])])
  await Bun.sleep(30)
  const msgReq = sent.filter((s) => s.cmd === SYNC_CMD.REQUEST)[1]
  answer(zca, msgReq.body, files, [messageChunk([['oneone/G_U1', [msg({ sender: 'G_U1', id: 1, ts: 1 })]]]), messageChunk([['oneone/G_U1', [msg({ sender: 'G_U1', id: 2, ts: 2 })]]])], { failIdx: 1 })
  await until(() => ['done', 'error'].includes(sync.status(ME)!.state))
  expect(sync.status(ME)).toMatchObject({ state: 'done', messages: 1 })
  expect(imported.flatMap((i) => i.msgs).map((m) => m.data.msgId)).toEqual(['2'])
})

test('the phone refusing ends the sync with its message, and the session is disposed', async () => {
  const { sync, zca, sent } = await setup()
  sync.start(ME)
  await Bun.sleep(10)
  const { syncId } = sent[0].body.data
  zca.emit('control', ME, { act_type: 'transfer_sync2', act: 'transfer_status', data: JSON.stringify({ syncId, status: 6, fromDevice: 0 }) })
  await Bun.sleep(10)
  expect(sync.status(ME)).toMatchObject({ state: 'error', error: 'Bạn đã từ chối yêu cầu đồng bộ trên điện thoại' })
  expect(sent.find((s) => s.cmd === SYNC_CMD.DISPOSE)?.body.data).toMatchObject({ syncId, reason: 2 })
})

test('stopped on the phone: disposed as a cancel', async () => {
  const { sync, zca, sent } = await setup()
  sync.start(ME)
  await Bun.sleep(10)
  const { syncId } = sent[0].body.data
  zca.emit('control', ME, { act_type: 'transfer_sync2', act: 'transfer_status', data: JSON.stringify({ syncId, status: 7, fromDevice: 0 }) })
  await Bun.sleep(10)
  expect(sync.status(ME)).toMatchObject({ state: 'error', error: 'Bạn đã dừng đồng bộ trên điện thoại' })
  expect(sent.find((s) => s.cmd === SYNC_CMD.DISPOSE)?.body.data).toMatchObject({ syncId, reason: 0 })
})

test('not offered when Zalo has not turned sync v2 on for the account (features.sync_2_pc)', async () => {
  const { sync, sent } = await setup({ enabled: false })
  expect(() => sync.start(ME)).toThrow('Zalo chưa bật tính năng đồng bộ tin nhắn cho tài khoản này')
  expect(sent).toEqual([])
})

test('no request before the socket is authenticated: a network error, nothing sent, nothing disposed', async () => {
  const { sync, sent } = await setup({ authed: false })
  sync.start(ME)
  await until(() => sync.status(ME)!.state === 'error')
  expect(sync.status(ME)).toMatchObject({ error: 'Hãy kiểm tra kết nối mạng và thử lại' })
  expect(sent).toEqual([])
})

test('a socket lost while waiting: retried twice (1 s, 2 s), then "hết hiệu lực"; no dispose of an unsent session', async () => {
  const { sync, sent, listener } = await setup({ reply: false })
  sync.start(ME)
  await Bun.sleep(10)
  listener.emit('disconnected')
  await Bun.sleep(1100)
  expect(sent.filter((s) => s.cmd === SYNC_CMD.REQUEST)).toHaveLength(2)
  listener.emit('disconnected')
  await Bun.sleep(2100)
  expect(sent.filter((s) => s.cmd === SYNC_CMD.REQUEST)).toHaveLength(3)
  listener.emit('disconnected')
  await until(() => sync.status(ME)!.state === 'error')
  expect(sync.status(ME)).toMatchObject({ error: 'Yêu cầu đồng bộ đã hết hiệu lực' })
  expect(sent.filter((s) => s.cmd === SYNC_CMD.DISPOSE)).toEqual([])
}, 10_000)
