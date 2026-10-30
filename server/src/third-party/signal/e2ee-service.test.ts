import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { API, TMessage } from '@hwqnq/zca-js'
import { openDatabase } from '../../dbs/sqlite'
import type { ZcaService } from '../zalo/zalo-client'
import { E2eeService } from './e2ee-service'

type Sent = { cmd: number; subCmd: number; body: { reqId?: string; data?: Record<string, any>; [key: string]: unknown } }
const frame = (cmd: number, subCmd: number, body: unknown) => {
  const head = Buffer.alloc(4)
  head[0] = 1
  head.writeUInt16LE(cmd, 1)
  head[3] = subCmd
  return Buffer.concat([head, Buffer.from(JSON.stringify(body))])
}
const plain = (data: unknown) => ({ error_code: 0, encrypt: 0, data: JSON.stringify({ error_code: 0, data }) })
const tick = () => Bun.sleep(20)

// a connected account whose socket answers signal requests through `answer`
const setup = (answer: (cmd: number, data: Record<string, any>) => unknown = () => ({})) => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '{}', 'ua', 1)`)
  const zca = new EventEmitter() as unknown as ZcaService
  const e2ee = new E2eeService(db, zca)
  const listener = Object.assign(new EventEmitter(), { ws: null as unknown })
  zca.emit('attached', 'me', { listener } as unknown as API)
  const connect = () => {
    const sent: Sent[] = []
    const ws = Object.assign(new EventEmitter(), {
      OPEN: 1,
      readyState: 1,
      sent,
      send(b: Buffer) {
        const s = { cmd: b.readUInt16LE(1), subCmd: b[3], body: JSON.parse(b.subarray(4).toString()) }
        sent.push(s)
        const r = s.body.reqId?.startsWith('signal_req_') ? answer(s.cmd, s.body.data ?? {}) : undefined
        if (r !== undefined) queueMicrotask(() => ws.emit('message', frame(s.cmd, 0, plain({ reqId: s.body.reqId, data: r }))))
      },
    })
    listener.ws = ws
    listener.emit('connected')
    return ws
  }
  return { db, zca, e2ee, connect }
}

test('after a reconnect, requests go out on the new socket and its replies are read', async () => {
  const { zca, e2ee, connect } = setup((cmd) => (cmd === 564 ? { err: -1 } : cmd === 563 ? { threads: [{ uid: 'peer' }] } : { ts: 1 }))
  const first = connect()
  const second = connect()
  zca.emit('ready', 'me')
  await tick()
  expect(first.sent).toEqual([])
  expect(second.sent.map((s) => s.cmd)).toEqual([564, 540, 563])
  expect(e2ee.state('me', 'peer')).toBe('on')
})

test("a conversation with E2EE history waits for Zalo's list; then the list decides", async () => {
  const { db, zca, e2ee, connect } = setup((cmd) => (cmd === 564 ? { err: -1 } : cmd === 563 ? { threads: [{ uid: 'peer' }] } : { ts: 1 }))
  db.run(`INSERT INTO message (accountId, msgId, toUid, fromUid, msgType, sendDttm, cmd) VALUES ('me', '1', 'old', 'old', 'chat.e2ee', 1, 551)`)
  expect([e2ee.state('me', 'old'), e2ee.state('me', 'plain')]).toEqual(['pending', 'off'])
  const changed: string[] = []
  e2ee.on('changed', (id) => changed.push(id))
  connect()
  zca.emit('ready', 'me')
  await tick()
  expect([e2ee.state('me', 'old'), e2ee.state('me', 'peer'), e2ee.state('me', 'plain')]).toEqual(['off', 'on', 'off'])
  expect(changed).toEqual(['me'])
})

test('the E2EE offline queues named in the auth frame are pulled from the last action id, page by page', async () => {
  const { e2ee, connect } = setup((cmd) => (cmd === 541 ? { keys: [] } : {}))
  const ws = connect()
  const offline: TMessage[][] = []
  e2ee.on('messages', (_, msgs) => offline.push(msgs))
  ws.emit('message', frame(1, 1, { key: 'k', encrypt: 0, error_code: 0, data: JSON.stringify({ error_code: 0, data: { qCmds: [{ cmd: 510, subCmd: 1 }, { cmd: 513, subCmd: 0 }, { cmd: 516, subCmd: 0 }] } }) }))
  await tick()
  const pulls = () => ws.sent.filter((s) => s.cmd === 513 || s.cmd === 516).map((s) => [s.cmd, s.subCmd, s.body.first, s.body.lastId])
  expect(pulls()).toEqual([
    [513, 0, true, 1],
    [516, 0, true, 1],
  ])

  const msg = { msgId: '9', cliMsgId: '9', uidFrom: 'peer', idTo: '0', cmd: 551, msgType: 'webchat', content: 'x' }
  ws.emit('message', frame(513, 0, plain({ msgs: [msg], more: 1, lastActionId: '55' })))
  ws.emit('message', frame(516, 0, plain({ eesession: [{ cmd: 581, msgId: '3', sessionData: { uidFrom: 'peer2', deviceId: 0, data: 'peer2' } }], lastActionId: '7' })))
  await tick()
  expect(offline).toEqual([[msg as unknown as TMessage]])
  expect(pulls().slice(2)).toEqual([[513, 0, false, '55']])
  expect(e2ee.state('me', 'peer2')).toBe('on')
  expect(ws.sent.find((s) => s.cmd === 545)?.body.data).toEqual({ queueName: '', info: [{ gid: '3', cmd: 581, subCmd: 0, sid: 'peer2', deviceId: 0 }] })
})

test('turning E2EE on waits until this device is set up', () => {
  const { e2ee } = setup()
  expect(() => e2ee.enable('me', 'peer')).toThrow('E2EE not initialized')
})
