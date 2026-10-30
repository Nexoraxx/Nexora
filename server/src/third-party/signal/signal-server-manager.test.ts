import { describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import { SignalServerManager } from './signal-server-manager'

describe('SignalServerManager', () => {
  it('encodes RPC frame and resolves matching response', async () => {
    const fakeWs = new EventEmitter() as any
    fakeWs.send = (buf: Buffer) => {
      // payload is after 4-byte header
      const payload = JSON.parse(buf.subarray(4).toString('utf8'))
      const resPayload = {
        cmd: 564,
        subCmd: 0,
        data: {
          reqId: payload.data.reqId,
          data: { keyId: 4321, submitTs: 1000 },
        },
      }
      const resHeader = Buffer.alloc(4)
      resHeader[0] = 1
      resHeader.writeUInt16LE(564, 1)
      resHeader[3] = 0
      const resBuf = Buffer.concat([resHeader, Buffer.from(JSON.stringify(resPayload))])
      setTimeout(() => fakeWs.emit('message', resBuf), 10)
    }

    const manager = new SignalServerManager(fakeWs)
    const keyInfo = await manager.getKeyId()
    expect(keyInfo).toEqual({ keyId: 4321, submitTs: 1000 })
  })

  it('handles server pushes for request prekeys', async () => {
    const fakeWs = new EventEmitter() as any
    fakeWs.send = () => {}
    const manager = new SignalServerManager(fakeWs)

    let pushReceived: any = null
    manager.on('request_prekeys', (data) => {
      pushReceived = data
    })

    // Simulate incoming push cmd 549
    const pushPayload = {
      cmd: 549,
      subCmd: 0,
      data: { type: 1 },
    }
    const pushHeader = Buffer.alloc(4)
    pushHeader[0] = 1
    pushHeader.writeUInt16LE(549, 1)
    pushHeader[3] = 0
    const pushBuf = Buffer.concat([pushHeader, Buffer.from(JSON.stringify(pushPayload))])
    fakeWs.emit('message', pushBuf)

    expect(pushReceived).toEqual({ type: 1 })
  })
})
