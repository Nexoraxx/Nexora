import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export interface KeyPair {
  pubKey: ArrayBuffer
  privKey: ArrayBuffer
}

export interface PreKey {
  keyId: number
  keyPair: KeyPair
}

export interface SignedPreKey {
  keyId: number
  keyPair: KeyPair
  signature: ArrayBuffer
}

let libsignalInstance: any = null

export function getLibSignal() {
  if (libsignalInstance) return libsignalInstance

  const win = globalThis as any
  win.window = globalThis
  win.libsignal = win.libsignal || {}

  const codePath = join(import.meta.dir, 'libsignal-protocol.static.js')
  const code = readFileSync(codePath, 'utf8')
  const fn = new Function('require', code)
  fn(undefined)

  libsignalInstance = win.libsignal
  // Zalo's server-configured max_message_keys (the library default is 2000)
  libsignalInstance.setConfig('max_message_keys', 10_000)
  return libsignalInstance
}

export async function deriveIdentityKeyPair(uid: string, deviceId = 2): Promise<KeyPair> {
  const lib = getLibSignal()
  const seed = createHash('sha256').update(`${uid}:${deviceId}`).digest()
  const ab = seed.buffer.slice(seed.byteOffset, seed.byteOffset + seed.byteLength)
  return await lib.KeyHelper.generateIdentityKeyPair(ab)
}
