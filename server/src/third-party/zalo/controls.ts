import { unzipSync } from 'node:zlib'
import JSONBig from 'json-bigint'
import type { API } from '@hwqnq/zca-js'
import type WebSocket from 'ws'

// big ids (uids, msgIds) stay exact as strings
const json = JSONBig({ storeAsString: true })

// a websocket control (cmd 601): conversation settings changed by this account elsewhere or by the other side
export type Control = { act_type?: string; act?: string; data?: unknown; [key: string]: unknown }
// a socket frame body: { error_code, data, encrypt }, or { key, ... } for the auth frame
export type Frame = { error_code?: number; data?: unknown; encrypt?: unknown; key?: string }
type Internals = { ws: WebSocket | null; cipherKey?: string }

// zca's decodeEventData, which zca doesn't export: encrypt 0 = JSON, 1 = base64, 2/3 = AES-GCM (iv 16, aad 16,
// then ciphertext + tag) of URI-encoded base64; gzip or zlib compressed (pako autodetects, so does unzip) except type 3
export async function decodeFrame(frame: Frame, cipherKey?: string) {
  const { data, encrypt } = frame
  if (typeof data !== 'string' || typeof encrypt !== 'number') return undefined
  if (encrypt === 0) return json.parse(data)
  let buf: Buffer = Buffer.from(encrypt === 1 ? data : decodeURIComponent(data), 'base64')
  if (encrypt !== 1) {
    if (!cipherKey || buf.length < 48) return undefined
    const bytes = (b: Buffer) => new Uint8Array(b)
    const algorithm = { name: 'AES-GCM', iv: bytes(buf.subarray(0, 16)), additionalData: bytes(buf.subarray(16, 32)), tagLength: 128 }
    const key = await crypto.subtle.importKey('raw', bytes(Buffer.from(cipherKey, 'base64')), algorithm, false, ['decrypt'])
    buf = Buffer.from(await crypto.subtle.decrypt(algorithm, key, bytes(buf.subarray(32))))
  }
  const text = (encrypt === 3 ? buf : unzipSync(buf)).toString('utf8')
  return text ? json.parse(text) : undefined
}

// Every frame of the chat socket, as zca's listener reads it. The socket is replaced on every reconnect, so the tap
// follows each new one.
export function tapFrames(listener: API['listener'], onFrame: (cmd: number, subCmd: number, frame: Frame, cipherKey?: string) => void) {
  const internals = listener as unknown as Internals
  listener.on('connected', () =>
    internals.ws?.on('message', (raw) => {
      const buf = Buffer.isBuffer(raw) ? raw : null
      // header: version, cmd (uint16 LE), subCmd
      if (!buf || buf.length < 4 || buf[0] !== 1) return
      let frame: Frame
      try {
        frame = JSON.parse(buf.subarray(4).toString('utf8'))
      } catch {
        return
      }
      onFrame(buf.readUInt16LE(1), buf[3], frame, internals.cipherKey)
    }),
  )
}

// Zalo PC's socket _send: header, then only the JSON of data
export function sendFrame(listener: API['listener'], cmd: number, subCmd: number, data: unknown) {
  const ws = (listener as unknown as Internals).ws
  if (!ws || ws.readyState !== ws.OPEN) throw Object.assign(new Error('Mất kết nối tới máy chủ'), { code: 'offline' })
  const head = Buffer.alloc(4)
  head[0] = 1
  head.writeUInt16LE(cmd, 1)
  head[3] = subCmd
  ws.send(Buffer.concat([head, Buffer.from(JSON.stringify(data), 'utf8')]))
}

// zca's listener only passes on file_done, group, voip, sync and fr controls; the rest (conv_settings, pin and mute
// changes, ...) are read here from the same socket frames.
export function tapControls(listener: API['listener'], onControl: (c: Control) => void) {
  tapFrames(listener, (cmd, subCmd, frame, cipherKey) => {
    if (cmd !== 601 || subCmd !== 0) return
    void Promise.resolve()
      .then(() => decodeFrame(frame, cipherKey))
      .then((d: { data?: { controls?: { content?: Control }[] } } | undefined) => {
        for (const c of d?.data?.controls ?? []) if (c.content) onControl(c.content)
      })
      .catch((e) => console.error('[zca] control frame', e))
  })
}

// control data comes as an object or a JSON string
export const controlData = <T>(c: Control): T => (typeof c.data === 'string' ? json.parse(c.data) : c.data) as T
