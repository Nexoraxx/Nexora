import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { API } from '@hwqnq/zca-js'
import { sendFrame } from '../zalo/controls'
import { SignalServerManager } from './signal-server-manager'

const cipherKey = randomBytes(32)

// the server's encrypt 2 frame data: base64(iv 16 ‖ aad 16 ‖ AES-GCM(gzip(json))), URI-encoded
const sealed = async (json: unknown) => {
  const iv = randomBytes(16)
  const aad = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new Uint8Array(cipherKey), 'AES-GCM', false, ['encrypt'])
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(iv), additionalData: new Uint8Array(aad), tagLength: 128 }, key, new Uint8Array(gzipSync(JSON.stringify(json))))
  return encodeURIComponent(Buffer.concat([iv, aad, Buffer.from(ct)]).toString('base64'))
}

const manager = () => {
  const sent: { cmd: number; subCmd: number; data: { reqId: string; data: unknown } }[] = []
  const rpc = new SignalServerManager((cmd, subCmd, data) => sent.push({ cmd, subCmd, data: data as { reqId: string; data: unknown } }))
  return { rpc, sent }
}

test("a frame on the socket is PC's: version 1, cmd uint16 LE, subCmd, then only the JSON of data", () => {
  const frames: Buffer[] = []
  const ws = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, send: (b: Buffer) => frames.push(b) })
  sendFrame({ ws } as unknown as API['listener'], 564, 0, { reqId: 'signal_req_0', data: { platformType: 2 } })
  expect([...frames[0].subarray(0, 4)]).toEqual([1, 564 & 0xff, 564 >> 8, 0])
  expect(JSON.parse(frames[0].subarray(4).toString())).toEqual({ reqId: 'signal_req_0', data: { platformType: 2 } })
  expect(() => sendFrame({ ws: Object.assign(ws, { readyState: 3 }) } as unknown as API['listener'], 564, 0, {})).toThrow()
})

test('a request resolves with the reply decrypted from its envelope, matched by reqId', async () => {
  const { rpc, sent } = manager()
  const keyId = rpc.getKeyId()
  expect(sent[0]).toEqual({ cmd: 564, subCmd: 0, data: { reqId: 'signal_req_0', data: { platformType: 2 } } })
  // another request's reply and a push are not this one's
  await rpc.onFrame(564, 0, { error_code: 0, encrypt: 2, data: await sealed({ error_code: 0, data: { reqId: 'signal_req_9', data: { keyId: 1 } } }) }, cipherKey.toString('base64'))
  await rpc.onFrame(564, 0, { error_code: 0, encrypt: 2, data: await sealed({ error_code: 0, data: { reqId: 'signal_req_0', data: { keyId: 4321, submitTs: 1000 } } }) }, cipherKey.toString('base64'))
  expect(await keyId).toEqual({ keyId: 4321, submitTs: 1000 })
})

test('err -1 on GET_KEY_ID means no key; any other err, inner or outer error_code fails the request', async () => {
  const { rpc } = manager()
  const reply = (reqId: string, data: unknown, error_code = 0) => rpc.onFrame(1, 0, { error_code: 0, encrypt: 0, data: JSON.stringify({ error_code, data: { reqId, data } }) })
  const none = rpc.getKeyId()
  await reply('signal_req_0', { err: -1 })
  expect(await none).toBeNull()
  const broken = rpc.getKeyId()
  await reply('signal_req_1', { err: -5 })
  await expect(broken).rejects.toMatchObject({ code: -5 })
  const inner = rpc.getBundle('u1')
  await reply('signal_req_2', {}, 114)
  await expect(inner).rejects.toMatchObject({ code: 114 })
  const outer = rpc.getBundle('u1')
  await rpc.onFrame(541, 0, { error_code: 112, data: JSON.stringify({ data: { reqId: 'signal_req_3' } }) })
  await expect(outer).rejects.toMatchObject({ code: 112 })
})

test('a frame with no pending request is a server push; DONE_PROCESS_SESSION goes out on subCmd 1', async () => {
  const { rpc, sent } = manager()
  const pushes: unknown[] = []
  rpc.on('push', (cmd, data) => pushes.push([cmd, data]))
  await rpc.onFrame(549, 0, { error_code: 0, encrypt: 0, data: JSON.stringify({ error_code: 0, data: { eesession: [{ msgId: '1', sessionData: { type: 1 } }] } }) })
  expect(pushes).toEqual([[549, { eesession: [{ msgId: '1', sessionData: { type: 1 } }] }]])
  void rpc.doneProcess({ msgId: '1', sessionData: { uidFrom: 'u', deviceId: 0 } }, 549).catch(() => {})
  expect(sent[0]).toMatchObject({ cmd: 545, subCmd: 1, data: { data: { queueName: '', info: [{ gid: '1', cmd: 549, subCmd: 0, sid: 'u', deviceId: 0 }] } } })
})

test("the E2EE list is read page by page as PC's default, all pages merged", async () => {
  const { rpc, sent } = manager()
  const reply = (i: number, data: unknown) => rpc.onFrame(563, 0, { error_code: 0, encrypt: 0, data: JSON.stringify({ error_code: 0, data: { reqId: `signal_req_${i}`, data } }) })
  const list = rpc.getE2eeList()
  await reply(0, { threads: [{ uid: 'a' }], waitUids: [], hasMore: 1, lastId: 'L1' })
  await Bun.sleep(1)
  expect(sent.map((s) => s.data.data)).toEqual([
    { reqIid: 1, first: true },
    { reqIid: 1, first: false, lastId: 'L1' },
  ])
  await reply(1, { threads: [{ uid: 'b' }], waitUids: ['c'], hasMore: 0 })
  expect(await list).toEqual({ threads: [{ uid: 'a' }, { uid: 'b' }], waitUids: ['c'] })
})

test("an error reply that doesn't name its request fails that command's pending request at once, not after 10 s", async () => {
  const { rpc } = manager()
  const bundle = rpc.getBundle('me')
  await rpc.onFrame(541, 0, { error_code: 112, encrypt: 0, data: JSON.stringify({ error_code: 112, error_message: 'Lỗi không xác định' }) })
  await expect(bundle).rejects.toMatchObject({ code: 112 })
})
