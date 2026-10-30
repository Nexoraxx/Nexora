import { EventEmitter } from 'node:events'
import { decodeFrame, type Frame } from '../zalo/controls'

// Zalo PC's SignalCommands (1-1 part)
export const SIGNAL_CMD = {
  SUBMIT_BUNDLE: 540,
  GET_BUNDLE: 541,
  SUBMIT_PREKEYS: 542,
  INIT_SESSION: 543,
  ACK_INIT_SESSION: 544,
  // server -> client: an init from the phone; client -> server: DONE_PROCESS_SESSION
  INIT_SESSION_MOBILE: 545,
  DONE_PROCESS_SESSION: 545,
  SESSION_OFFLINE: 516,
  NOTIFY_DELETE_KEY: 548,
  REQUEST_PREKEYS: 549,
  RECEIVE_ONEONE: 551,
  GET_LIST_USER_E2EE: 563,
  GET_KEY_ID: 564,
  DISABLE_E2EE: 580,
  ENABLE_E2EE: 581,
} as const
// offline queues of 1-1 E2EE messages for a PC device (513, 713 = its "SF_ID" twin) and of session events
export const E2EE_QUEUES = new Set([513, 713, SIGNAL_CMD.SESSION_OFFLINE])
export const SIGNAL_FRAMES = new Set<number>([...Object.values(SIGNAL_CMD), ...E2EE_QUEUES])

export const ACK_TYPE = { FAILED: 0, SUCCESS: 1 }

export type BundleKey = { id: number; key: string }
export type PreKeyBundlePayload = {
  delSS: number
  key: { deviceId: number; preKey: { iKey: BundleKey; signature: string; spKey: BundleKey }; opKeys: BundleKey[] }
}
export type DeviceBundle = { deviceId: number; preKey?: { iKey: BundleKey; signature: string; spKey: BundleKey }; opKeys?: BundleKey[] }
// a server push or offline queue item; cmd is set in the offline session queue
export type SessionEvent = {
  msgId?: string
  cmd?: number
  sessionData: { uidFrom: string; uidTo?: string; deviceId: number; data?: string; ts?: number | string; reqServerTs?: number | string; type?: number; deleteType?: number; threadId?: string }
}
export type E2eeList = { threads?: { uid: string; devices?: { di: number; iid: number }[] }[]; waitUids?: string[] }

type Reply = { error_code?: number; data?: { reqId?: string; data?: { err?: number; [key: string]: unknown } } }
type Pending = { resolve: (data: Record<string, unknown> | undefined) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

const failure = (cmd: number, code: unknown) => Object.assign(new Error(`Signal ${cmd} lỗi ${code}`), { code: Number(code) })

// Zalo PC's signal-server-manager: request/response over the chat socket, matched by reqId; frames without a pending
// reqId are server pushes, emitted as ('push', cmd, data).
export class SignalServerManager extends EventEmitter {
  private nextId = 0
  private pending = new Map<string, Pending & { cmd: number }>()

  constructor(private send: (cmd: number, subCmd: number, data: unknown) => void) {
    super()
  }

  // a reply is { error_code, data, encrypt }: data decrypts to { error_code, data: { reqId, data } }
  async onFrame(cmd: number, subCmd: number, frame: Frame, cipherKey?: string) {
    if (frame.error_code) {
      // PC's handleRespDataError: the request is still named in the raw data
      let reqId: string | undefined
      try {
        reqId = JSON.parse(String(frame.data))?.data?.reqId
      } catch {}
      return this.settle(reqId, frame.error_code)
    }
    const reply = (await decodeFrame(frame, cipherKey)) as Reply | undefined
    if (!reply) return
    const reqId = reply.data?.reqId
    if (reqId && this.pending.has(reqId)) return this.settle(reqId, reply.error_code, reply.data?.data)
    if (!reply.error_code) this.emit('push', cmd, reply.data ?? {}, subCmd)
  }

  private settle(reqId: string | undefined, code?: number, data?: Record<string, unknown>) {
    const p = reqId ? this.pending.get(reqId) : undefined
    if (!p) return
    this.pending.delete(reqId!)
    clearTimeout(p.timer)
    if (code) p.reject(failure(p.cmd, code))
    else p.resolve(data)
  }

  // the reply's data.data; an `err` in it is the command's own failure
  request<T = Record<string, unknown>>(cmd: number, data: unknown, subCmd = 0, timeoutMs = 10_000): Promise<T> {
    const reqId = `signal_req_${this.nextId++}`
    return new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(failure(cmd, 'timeout'))
      }, timeoutMs)
      this.pending.set(reqId, { cmd, resolve, reject, timer })
      try {
        this.send(cmd, subCmd, { reqId, data })
      } catch (e) {
        this.pending.delete(reqId)
        clearTimeout(timer)
        reject(e)
      }
    }).then((d) => {
      if (d?.err) throw failure(cmd, d.err)
      return d as T
    })
  }

  // null: no key registered for this device (err -1)
  async getKeyId(): Promise<{ keyId: number; submitTs?: number } | null> {
    try {
      const d = await this.request<{ keyId: number; submitTs?: number }>(SIGNAL_CMD.GET_KEY_ID, { platformType: 2 })
      return d?.keyId ? d : null
    } catch (e) {
      if ((e as { code?: number }).code === -1) return null
      throw e
    }
  }

  submitBundle(bundle: PreKeyBundlePayload) {
    return this.request(SIGNAL_CMD.SUBMIT_BUNDLE, bundle)
  }

  submitPreKeys(regId: number, opKeys: BundleKey[]) {
    return this.request(SIGNAL_CMD.SUBMIT_PREKEYS, { deviceId: 2, id: regId, opKeys })
  }

  // every device of uid (deviceId -1)
  async getBundle(uid: string, isReInit = false): Promise<DeviceBundle[]> {
    const d = await this.request<{ keys?: { uid: string; keys?: DeviceBundle[] }[] }>(SIGNAL_CMD.GET_BUNDLE, {
      uids: [{ uid, deviceId: -1 }],
      isReInit: isReInit ? 1 : 0,
      msgInfoNoti: 0,
      isAutoUpgrade: 0,
    })
    return d?.keys?.find((k) => String(k.uid) === uid)?.keys ?? []
  }

  initSession(uidTo: string, data: { deviceId: number; data: string }[], enable = true) {
    return this.request(SIGNAL_CMD.INIT_SESSION, { type: enable ? 1 : 0, uidTo, data })
  }

  ackSession(uidTo: string, deviceId: number, ts: number, payload: { data: string } | { iid: number }, type: number) {
    return this.request(SIGNAL_CMD.ACK_INIT_SESSION, { type, uidTo, data: [{ deviceId, ts, ...payload }] })
  }

  // PC sends it without a subCmd, so its socket's default 1
  doneProcess(e: SessionEvent, cmd: number) {
    return this.request(SIGNAL_CMD.DONE_PROCESS_SESSION, { queueName: '', info: [{ gid: e.msgId, cmd, subCmd: 0, sid: e.sessionData.uidFrom, deviceId: e.sessionData.deviceId }] }, 1)
  }

  // PC's getListUserE2eeWithPagination (first page, then lastId while hasMore), the one-shot list when that fails
  async getE2eeList(): Promise<E2eeList> {
    try {
      const all = { threads: [] as NonNullable<E2eeList['threads']>, waitUids: [] as string[] }
      for (let lastId: unknown; ; ) {
        const page = await this.request<E2eeList & { hasMore?: number; lastId?: unknown }>(SIGNAL_CMD.GET_LIST_USER_E2EE, lastId === undefined ? { reqIid: 1, first: true } : { reqIid: 1, first: false, lastId })
        all.threads.push(...(page?.threads ?? []))
        all.waitUids.push(...(page?.waitUids ?? []))
        if (!page?.hasMore) return all
        lastId = page.lastId
      }
    } catch (e) {
      console.error('[e2ee] paged E2EE list', e)
      return this.request<E2eeList>(SIGNAL_CMD.GET_LIST_USER_E2EE, { reqIid: 1 })
    }
  }
}
