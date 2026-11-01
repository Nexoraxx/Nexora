import { spawn, type ChildProcess } from 'node:child_process'
import { createCipheriv, createDecipheriv } from 'node:crypto'
import { rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Zalo PC main.js (module "3Zc2") ⇄ its call helper ZaloCall: two local sockets, each message
// hex(AES-128-CBC(JSON, zero IV)) + "$", key callV2TransportAesKey (docs/data/call-signaling.md §4.2).
const KEY = Buffer.from('yjAF9oqMWl6XfXYJn9mA7w==', 'base64')
const IV = Buffer.alloc(16)
const isWin = process.platform === 'win32'

export type NativeMessage = { type: string; command?: string | number; data?: unknown }

export function encryptMessage(m: unknown) {
  const c = createCipheriv('aes-128-cbc', KEY, IV)
  return Buffer.concat([c.update(JSON.stringify(m), 'utf8'), c.final()]).toString('hex')
}

export function decryptMessage(hex: string): NativeMessage {
  const d = createDecipheriv('aes-128-cbc', KEY, IV)
  return JSON.parse(Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()]).toString('utf8').replace(/\0/g, ''))
}

// main.js "4KIH": off Windows a long message goes out in 4000-char chunks "<hex>#<msgId>#<total>#<idx>#$",
// each one after the helper answers "ack" to the previous write
let lastMsgId = 0
export function chunk(hex: string): string[] {
  const total = Math.ceil(hex.length / 4000)
  if (total <= 1) return [hex + '$']
  const id = (lastMsgId = Math.max(lastMsgId + 1, Date.now()))
  return Array.from({ length: total }, (_, i) => `${hex.slice(i * 4000, (i + 1) * 4000)}#${id}#${total}#${i}#$`)
}

let seq = 0

// One running helper. Messages written before it says native-ready wait in a queue, the init payload first (as main.js).
export class NativeLink {
  private child?: ChildProcess
  private servers: Server[] = []
  private paths: string[] = []
  private out?: Socket
  private ready = false
  private queue: unknown[] = []
  private chunks: string[] = []
  private writing = false
  private closed = false

  constructor(
    exe: string,
    args: string[],
    private init: () => unknown,
    private onMessage: (m: NativeMessage) => void,
    private onExit: () => void,
  ) {
    const id = `${process.pid}-${++seq}`
    // argv[1]: helper → us, argv[2]: us → helper
    const [recvPath, sendPath] = ['recv', 'send'].map((k) => (isWin ? `\\\\.\\pipe\\NexoraCall${k}-${id}` : join(tmpdir(), `nexora-call-${id}-${k}`)))
    this.paths = isWin ? [] : [recvPath, sendPath]
    for (const p of this.paths) rmSync(p, { force: true })

    let inbox = ''
    const recv = createServer((s) =>
      s.on('data', (d) => {
        const parts = (inbox += d.toString('latin1')).split('$')
        inbox = parts.pop()!
        for (const p of parts) if (p) this.receive(p)
      }),
    )
    const send = createServer((s) => {
      this.out = s
      // the helper answers every read with "ack": next chunk
      s.on('data', () => ((this.writing = false), this.pump()))
      s.on('error', () => {})
      this.pump()
    })
    this.servers = [recv, send]
    let listening = 0
    const start = () => {
      if (++listening < 2 || this.closed) return
      this.child = spawn(exe, [...args, recvPath, sendPath], { stdio: ['ignore', 'pipe', 'pipe'] })
      const log = (d: Buffer) => d.toString().trim() && console.log(`[zcall] ${d.toString().trim()}`)
      this.child.stdout?.on('data', log)
      this.child.stderr?.on('data', log)
      this.child.on('error', (e) => console.error('[zcall] helper failed to start', e))
      this.child.on('exit', (code) => (console.log(`[zcall] helper exited (${code})`), this.close()))
    }
    recv.listen(recvPath, start)
    send.listen(sendPath, start)
    recv.on('error', (e) => (console.error('[zcall] recv socket', e), this.close()))
    send.on('error', (e) => (console.error('[zcall] send socket', e), this.close()))
  }

  send(m: unknown) {
    if (!this.ready) return void this.queue.push(m)
    const hex = encryptMessage(m)
    // Windows: whole messages, no ack (main.js "V")
    this.chunks.push(...(isWin ? [hex + '$'] : chunk(hex)))
    this.pump()
  }

  private pump() {
    while (this.out && !this.writing && this.chunks.length) {
      this.out.write(this.chunks.shift()!)
      this.writing = !isWin
    }
  }

  private receive(hex: string) {
    let m: NativeMessage
    try {
      m = decryptMessage(hex)
    } catch {
      return console.error('[zcall] unreadable message from helper')
    }
    if (m.type === 'update' && m.command === 'native-ready') {
      this.ready = true
      for (const q of [this.init(), ...this.queue.splice(0)]) this.send(q)
      return
    }
    this.onMessage(m)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.child?.kill()
    for (const s of this.servers) s.close()
    for (const p of this.paths) rmSync(p, { force: true })
    this.onExit()
  }
}
