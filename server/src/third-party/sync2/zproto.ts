// Zalo PC's libzproto (Rust → WASM, the same file in the Windows and macOS builds): the crypto of "Đồng bộ tin nhắn"
// (sync v2). This is the wasm-bindgen glue of pc-dist/shared-worker.*.js module "Vox7", cut to what a receiving PC
// uses. Keys and session records are raw bytes.
import wasmPath from './libzproto_wasm_bg.wasm' with { type: 'file' }

type Exports = Record<string, (...args: number[]) => number> & { memory: WebAssembly.Memory }
export type KeyPair = { publicKey: Uint8Array; privateKey: Uint8Array }

let w: Exports
const heap: unknown[] = new Array(128).fill(undefined).concat([undefined, null, true, false])
let free = heap.length
const get = (i: number) => heap[i]
const add = (o: unknown) => {
  if (free === heap.length) heap.push(heap.length + 1)
  const i = free
  free = heap[i] as number
  heap[i] = o
  return i
}
const take = (i: number) => {
  const o = heap[i]
  if (i >= 132) {
    heap[i] = free
    free = i
  }
  return o
}
const mem = () => new Uint8Array(w.memory.buffer)
const view = () => new DataView(w.memory.buffer)
const decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true })
const str = (p: number, n: number) => decoder.decode(mem().subarray(p >>> 0, (p >>> 0) + n))
const guard =
  (f: (...a: any[]) => unknown) =>
  (...a: any[]) => {
    try {
      return f(...a)
    } catch (e) {
      w.__wbindgen_export_0(add(e))
    }
  }
// passArray8ToWasm0: returns [ptr, len]
const bytes = (b: Uint8Array): [number, number] => {
  const p = w.__wbindgen_export_2(b.length, 1) >>> 0
  mem().set(b, p)
  return [p, b.length]
}
const string = (s: string): [number, number] => bytes(new TextEncoder().encode(s))

const imports = {
  wbg: {
    __wbg_apply_36be6a55257c99bf: guard((f, t, a) => add((get(f) as Function).apply(get(t), get(a) as unknown[]))),
    __wbg_buffer_609cc3eee51ed158: (i: number) => add((get(i) as WebAssembly.Memory).buffer),
    __wbg_call_672a4d21634d4a24: guard((f, t) => add((get(f) as Function).call(get(t)))),
    __wbg_call_7cccdd69e0791ae2: guard((f, t, a) => add((get(f) as Function).call(get(t), get(a)))),
    __wbg_crypto_ed58b8e10a292839: (i: number) => add((get(i) as { crypto: unknown }).crypto),
    __wbg_error_7534b8e9a36f1ab4: (p: number, n: number) => {
      try {
        console.error(str(p, n))
      } finally {
        w.__wbindgen_export_1(p, n, 1)
      }
    },
    __wbg_getRandomValues_bcb4912f16000dc4: guard((c, b) => (get(c) as Crypto).getRandomValues(get(b) as Uint8Array)),
    __wbg_msCrypto_0a36e2ec3a343d26: (i: number) => add((get(i) as { msCrypto: unknown }).msCrypto),
    __wbg_new_405e22f390576ce2: () => add({}),
    __wbg_new_78feb108b6472713: () => add([]),
    __wbg_new_8a6f238a6ece86ea: () => add(new Error()),
    __wbg_new_a12002a7f91c75be: (i: number) => add(new Uint8Array(get(i) as ArrayBuffer)),
    __wbg_newnoargs_105ed471475aaf50: (p: number, n: number) => add(new Function(str(p, n))),
    __wbg_newwithbyteoffsetandlength_d97e637ebe145a9a: (i: number, o: number, n: number) => add(new Uint8Array(get(i) as ArrayBuffer, o >>> 0, n >>> 0)),
    __wbg_newwithlength_a381634e90c276d4: (n: number) => add(new Uint8Array(n >>> 0)),
    __wbg_node_02999533c4ea02e3: (i: number) => add((get(i) as { node: unknown }).node),
    __wbg_process_5c1d670bc53614b8: (i: number) => add((get(i) as { process: unknown }).process),
    __wbg_push_737cfc8c1432c2c6: (a: number, v: number) => (get(a) as unknown[]).push(get(v)),
    __wbg_randomFillSync_ab2cfe79ebbf2740: guard((c, b) => (get(c) as { randomFillSync(b: unknown): void }).randomFillSync(take(b))),
    __wbg_require_79b1e9274cde3c87: guard(() => add(require)),
    __wbg_set_3f1d0b984ed272ed: (o: number, k: number, v: number) => {
      ;(get(o) as Record<string, unknown>)[take(k) as string] = take(v)
    },
    __wbg_set_65595bdd868b3009: (a: number, b: number, o: number) => (get(a) as Uint8Array).set(get(b) as Uint8Array, o >>> 0),
    __wbg_stack_0ed75d68575b0f3c: (ret: number, i: number) => {
      const [p, n] = string(String((get(i) as Error).stack))
      view().setInt32(ret + 4, n, true)
      view().setInt32(ret, p, true)
    },
    __wbg_static_accessor_GLOBAL_88a902d13a557d07: () => add(globalThis),
    __wbg_static_accessor_GLOBAL_THIS_56578be7e9f832b0: () => add(globalThis),
    __wbg_static_accessor_SELF_37c5d418e4bf5819: () => 0,
    __wbg_static_accessor_WINDOW_5de37043a91a9c40: () => 0,
    __wbg_subarray_aa9065fa9dc5df96: (i: number, s: number, e: number) => add((get(i) as Uint8Array).subarray(s >>> 0, e >>> 0)),
    __wbg_versions_c71aa1626a93e0a1: (i: number) => add((get(i) as { versions: unknown }).versions),
    __wbindgen_is_function: (i: number) => typeof get(i) === 'function',
    __wbindgen_is_object: (i: number) => typeof get(i) === 'object' && get(i) !== null,
    __wbindgen_is_string: (i: number) => typeof get(i) === 'string',
    __wbindgen_is_undefined: (i: number) => get(i) === undefined,
    __wbindgen_memory: () => add(w.memory),
    __wbindgen_number_new: (n: number) => add(n),
    __wbindgen_object_clone_ref: (i: number) => add(get(i)),
    __wbindgen_object_drop_ref: (i: number) => void take(i),
    __wbindgen_string_new: (p: number, n: number) => add(str(p, n)),
    __wbindgen_throw: (p: number, n: number) => {
      throw new Error(str(p, n))
    },
  },
}

let ready: Promise<void> | undefined
export const initZproto = () =>
  (ready ??= Bun.file(wasmPath)
    .arrayBuffer()
    .then((b) => WebAssembly.instantiate(b, imports))
    .then(({ instance }) => void (w = instance.exports as unknown as Exports)))

// fn(retptr, ...args) leaves { ptr, errIdx, isErr } at retptr: the wrapped object's pointer, or a thrown JS value
function call(fn: string, ...args: number[]) {
  const ret = w.__wbindgen_add_to_stack_pointer(-16)
  try {
    w[fn](ret, ...args)
    const v = view()
    if (v.getInt32(ret + 8, true)) throw take(v.getInt32(ret + 4, true))
    return v.getInt32(ret, true) >>> 0
  } finally {
    w.__wbindgen_add_to_stack_pointer(16)
  }
}
// read the getters (each returns a Uint8Array off the heap), then free the wrapped object
function unwrap<K extends string>(cls: string, ptr: number, fields: K[]) {
  const out = Object.fromEntries(fields.map((f) => [f, (take(w[`${cls}_${f}`](ptr)) as Uint8Array).slice()])) as Record<K, Uint8Array>
  w[`__wbg_${cls}_free`](ptr, 0)
  return out
}

export const generateKeyPair = (): KeyPair => unwrap('zprotoed25519keypair', call('zprotoEd25519GenerateKeyPair'), ['publicKey', 'privateKey'])

// the first batch of a sync session: the phone's metadata cipher for our identity (ik) and ephemeral (ek) keys; its
// sessionRecord decrypts every message batch of the session
export const decryptMetadata = (cipher: Uint8Array, ik: KeyPair, ekPrivate: Uint8Array) =>
  unwrap('zprotosyncmetadatadecrypted', call('zprotoSync2DecryptMetadata', ...bytes(cipher), ...bytes(ik.publicKey), ...bytes(ik.privateKey), ...bytes(ekPrivate), 0, 0), ['sessionRecord', 'plaintext'])

export const decryptMessage = (cipher: Uint8Array, sessionRecord: Uint8Array) =>
  unwrap('zprotosyncmessagedecrypted', call('zprotoSync2DecryptMessage', ...bytes(cipher), ...bytes(sessionRecord)), ['plaintext']).plaintext

// the phone's side, for tests: (plaintext, sender ik, receiver ik public, receiver ek public)
export const createMetadata = (plain: Uint8Array, sender: KeyPair, receiverIk: Uint8Array, receiverEk: Uint8Array) =>
  unwrap('zprotosyncmetadataencrypted', call('zprotoSync2CreateMetadataCipher', ...bytes(plain), ...bytes(sender.publicKey), ...bytes(sender.privateKey), ...bytes(receiverIk), ...bytes(receiverEk), 0, 0), ['ciphertext', 'sessionRecord'])
export const encryptMessage = (sessionRecord: Uint8Array, plain: Uint8Array) =>
  unwrap('zprotosyncmessageencrypted', call('zprotoSync2EncryptMessage', ...bytes(plain), ...bytes(sessionRecord)), ['ciphertext']).ciphertext
