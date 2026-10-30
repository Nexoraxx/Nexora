import { EventEmitter } from 'node:events'
import type WebSocket from 'ws'

export const SIGNAL_CMD = {
  SUBMIT_BUNDLE: 540,
  GET_BUNDLE: 541,
  SUBMIT_PREKEYS: 542,
  INIT_SESSION: 543,
  ACK_INIT_SESSION: 544,
  DONE_PROCESS_SESSION: 545,
  DELETE_KEY: 547,
  NOTIFY_DELETE_KEY: 548,
  REQUEST_PREKEYS: 549,
  RECEIVE_ONEONE: 551,
  GET_KEY_ID: 564,
  DISABLE: 580,
  ENABLE: 581,
} as const

export interface BundlePreKey {
  iKey: { id: number; key: string }
  signature: string
  spKey: { id: number; key: string }
}

export interface BundleOpKey {
  id: number
  key: string
}

export interface PreKeyBundlePayload {
  delSS?: number
  key: {
    deviceId: number
    preKey: BundlePreKey
    opKeys: BundleOpKey[]
  }
}

export interface PeerBundleDevice {
  deviceId: number
  preKey: BundlePreKey
  opKeys?: BundleOpKey[]
}

export interface PeerBundleResponse {
  keys?: {
    uid: string
    keys: PeerBundleDevice[]
  }[]
  err?: number
}

export class SignalServerManager extends EventEmitter {
  private reqIdCounter = 1
  private pending = new Map<
    string,
    {
      cmd: number
      resolve: (data: any) => void
      reject: (err: any) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  constructor(private ws: WebSocket | { send(data: any): void; on(event: string, fn: any): void }) {
    super()
    this.ws.on('message', this.handleMessage.bind(this))
  }

  private handleMessage(raw: any) {
    const buf = Buffer.isBuffer(raw) ? raw : null
    if (!buf || buf.length < 4 || buf[0] !== 1) return

    const cmd = buf.readUInt16LE(1)
    const subCmd = buf[3]

    let payload: any
    try {
      payload = JSON.parse(buf.subarray(4).toString('utf8'))
    } catch {
      return
    }

    const reqId = payload?.data?.reqId
    if (reqId && this.pending.has(reqId)) {
      const entry = this.pending.get(reqId)!
      this.pending.delete(reqId)
      clearTimeout(entry.timer)

      const innerData = payload.data?.data ?? payload.data
      const err = payload.data?.err ?? payload.err
      if (err !== undefined && err !== 0) {
        if (cmd === SIGNAL_CMD.GET_KEY_ID && err === -1) {
          // err -1 means no key registered on server yet
          entry.resolve(null)
          return
        }
        entry.reject(new Error(`Signal RPC ${cmd} returned error code ${err}`))
        return
      }
      entry.resolve(innerData)
      return
    }

    // Server-pushed commands
    const data = payload?.data?.data ?? payload?.data ?? {}
    switch (cmd) {
      case SIGNAL_CMD.REQUEST_PREKEYS:
        this.emit('request_prekeys', data)
        break
      case SIGNAL_CMD.NOTIFY_DELETE_KEY:
        this.emit('notify_delete_key', data)
        break
      case SIGNAL_CMD.DISABLE:
        this.emit('disable', data)
        break
      case SIGNAL_CMD.ENABLE:
        this.emit('enable', data)
        break
      case SIGNAL_CMD.INIT_SESSION:
        this.emit('incoming_init_session', { ...data, subCmd })
        break
      case SIGNAL_CMD.ACK_INIT_SESSION:
        this.emit('ack_init_session', data)
        break
      case SIGNAL_CMD.RECEIVE_ONEONE:
        this.emit('receive_oneone', payload)
        break
      default:
        break
    }
  }

  sendRpc<T>(cmd: number, data: unknown, timeoutMs = 10000): Promise<T> {
    const reqId = `signal_req_${this.reqIdCounter++}`
    const payload = {
      cmd,
      subCmd: 0,
      data: {
        reqId,
        data,
      },
    }

    const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf8')
    const header = Buffer.alloc(4)
    header[0] = 1
    header.writeUInt16LE(cmd, 1)
    header[3] = 0
    const frame = Buffer.concat([header, jsonBuf])

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new Error(`Signal RPC ${cmd} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pending.set(reqId, { cmd, resolve, reject, timer })
      try {
        this.ws.send(frame)
      } catch (err) {
        this.pending.delete(reqId)
        clearTimeout(timer)
        reject(err)
      }
    })
  }

  async getKeyId(): Promise<{ keyId: number; submitTs: number } | null> {
    return this.sendRpc<{ keyId: number; submitTs: number } | null>(SIGNAL_CMD.GET_KEY_ID, {
      platformType: 2,
    })
  }

  async submitBundle(bundle: PreKeyBundlePayload): Promise<{ ts: number }> {
    return this.sendRpc<{ ts: number }>(SIGNAL_CMD.SUBMIT_BUNDLE, bundle)
  }

  async submitPreKeys(payload: { deviceId: number; id: number; opKeys: BundleOpKey[] }): Promise<{ ts: number }> {
    return this.sendRpc<{ ts: number }>(SIGNAL_CMD.SUBMIT_PREKEYS, payload)
  }

  async getBundle(uids: { uid: string; deviceId: number }[], isReInit = 0): Promise<PeerBundleResponse> {
    return this.sendRpc<PeerBundleResponse>(SIGNAL_CMD.GET_BUNDLE, {
      uids,
      isReInit,
      msgInfoNoti: 0,
      isAutoUpgrade: 0,
    })
  }

  async initSession(uidTo: string, data: { deviceId: number; data: string }[]): Promise<void> {
    return this.sendRpc<void>(SIGNAL_CMD.INIT_SESSION, {
      type: 1,
      uidTo,
      data,
    })
  }

  async ackInitSession(uidTo: string, data: { deviceId: number; ts: number; data: string }[]): Promise<void> {
    return this.sendRpc<void>(SIGNAL_CMD.ACK_INIT_SESSION, {
      type: 1,
      uidTo,
      data,
    })
  }

  async doneProcessSession(info: { gid?: string; cmd: number; subCmd: number; sid?: string; deviceId: number }[]): Promise<void> {
    return this.sendRpc<void>(SIGNAL_CMD.DONE_PROCESS_SESSION, {
      queueName: '',
      info,
    })
  }
}
