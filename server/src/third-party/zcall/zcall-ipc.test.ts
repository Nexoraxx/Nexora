import { expect, test } from 'bun:test'
import { chmodSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chunk, decryptMessage, encryptMessage, NativeLink, type NativeMessage } from './zcall-ipc'

test('framing: AES-128-CBC hex round trip, 4000-char chunks with #msgId#total#idx#', () => {
  const hex = encryptMessage({ type: 'update', command: 'native-ready' })
  expect(hex).toMatch(/^[0-9a-f]+$/)
  expect(hex.length % 32).toBe(0)
  expect(decryptMessage(hex)).toEqual({ type: 'update', command: 'native-ready' })
  expect(chunk('ab')).toEqual(['ab$'])
  const parts = chunk('x'.repeat(9000))
  expect(parts).toHaveLength(3)
  expect(parts[2]).toMatch(/^x{1000}#\d+#3#2#\$$/)
})

// A fake helper speaking ZaloCall's side: connects to argv[2] (us → helper) and argv[1] (helper → us), says
// native-ready, acks every read, reassembles chunks, then asks for signal 401 once it has init + makeCall.
const FAKE = `#!/usr/bin/env bun
import { connect } from 'node:net'
import { decryptMessage, encryptMessage } from '${join(import.meta.dir, 'zcall-ipc.ts')}'
const [, , recvPath, sendPath] = process.argv
const up = connect(recvPath)
const down = connect(sendPath)
let buf = '', parts = [], got = []
down.on('data', (d) => {
  down.write('ack')
  buf += d.toString()
  let i
  while ((i = buf.indexOf('$')) >= 0) {
    const piece = buf.slice(0, i); buf = buf.slice(i + 1)
    const m = /^(.*)#(\\d+)#(\\d+)#(\\d+)#$/.exec(piece)
    if (m) { parts[+m[4]] = m[1]; if (parts.filter(Boolean).length < +m[3]) continue }
    const msg = decryptMessage(m ? parts.join('') : piece); parts = []
    got.push(msg.command)
    if (got.length === 2) up.write(encryptMessage({ type: 'sendSignal', command: 401, data: { got, nameLength: msg.data.partner[0].name.length } }) + '$')
  }
})
up.on('connect', () => up.write(encryptMessage({ type: 'update', command: 'native-ready' }) + '$'))
`

test.skipIf(process.platform === 'win32')('NativeLink: native-ready flushes init then queued messages, chunked with acks', async () => {
  const exe = join(tmpdir(), `nexora-fake-zcall-${process.pid}`)
  writeFileSync(exe, FAKE)
  chmodSync(exe, 0o755)
  const received = new Promise<NativeMessage>((resolve) => {
    const link = new NativeLink(exe, [], () => ({ type: 'update', command: 'init', data: {} }), (m) => (resolve(m), link.close()), () => {})
    // queued before the helper is up, and long enough to need 3 chunks
    link.send({ type: 'request', command: 'makeCall', data: { partner: [{ id: '1', name: 'n'.repeat(5000) }], type: 1 } })
  })
  expect(await received).toEqual({ type: 'sendSignal', command: 401, data: { got: ['init', 'makeCall'], nameLength: 5000 } })
})
