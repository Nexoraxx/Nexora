import { zstdDecompressSync } from 'node:zlib'

// A sync v2 batch file (msgUrl) as Zalo PC's message/conversation builders read it: frames of
// [uint32 LE length][cipher], each decrypting to a zstd-compressed protobuf Sync2 SyncChunk.

export function* frames(buf: Uint8Array) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  for (let at = 0; at + 4 <= buf.length; ) {
    const n = view.getUint32(at, true)
    yield buf.subarray(at + 4, at + 4 + n)
    at += 4 + n
  }
}

export const decompress = (b: Uint8Array) => new Uint8Array(zstdDecompressSync(b))

// ===== protobuf (proto.Sync2.* of pc-dist/shared-worker.*.js) =====

// str: string, num: varint as a number (int32 sign kept), id: varint as a decimal string (64-bit ids), msg: nested
type Field = [name: string, kind: 'str' | 'num' | 'id' | 'bool' | Schema, repeated?: true]
type Schema = Record<number, Field>

const Attach: Schema = {
  1: ['type', 'str'], 2: ['extInfo', 'str'], 3: ['action', 'str'], 4: ['params', 'str'], 5: ['title', 'str'], 6: ['href', 'str'],
  7: ['thumb', 'str'], 8: ['description', 'str'], 9: ['catId', 'num'], 10: ['id', 'num'], 11: ['childNumber', 'num'],
  12: ['remains', 'str'], 13: ['zinstantData', 'str'], 14: ['zinstantMsg', 'str'],
}
const Meta: Schema = {
  1: ['attachs', Attach, true],
  2: ['mentions', { 1: ['uid', 'str'], 2: ['pos', 'num'], 3: ['len', 'num'], 4: ['type', 'num'] }, true],
  3: ['reference', { 1: ['type', 'num'], 2: ['data', 'str'] }],
  4: ['quote', {
    1: ['attach', 'str'], 2: ['ownerId', 'str'], 3: ['ts', 'num'], 4: ['fromD', 'str'], 5: ['cliMsgId', 'num'], 6: ['globalMsgId', 'id'],
    7: ['msg', 'str'], 8: ['cliMsgType', 'num'], 9: ['ttl', 'num'], 10: ['partialQuote', 'str'],
  }],
  5: ['property', { 1: ['size', 'num'], 2: ['color', 'num'], 3: ['type', 'num'], 4: ['subType', 'num'], 5: ['ext', 'str'] }],
  6: ['ttl', 'num'],
}
const SyncMessage: Schema = {
  1: ['senderId', 'str'], 2: ['clientId', 'id'], 3: ['msgStatus', 'num'], 4: ['msgType', 'num'], 5: ['timestamp', 'num'],
  6: ['globalId', 'id'], 7: ['content', 'str'], 8: ['meta', Meta],
}
const MessageChunk: Schema = { 1: ['platform', 'num'], 2: ['partitions', { 1: ['id', 'str'], 2: ['messages', SyncMessage, true] }, true] }
const ConversationChunk: Schema = {
  1: ['platform', 'num'],
  2: ['conversations', { 1: ['convId', 'str'], 2: ['convType', 'num'], 3: ['respondedByMe', 'bool'], 4: ['lastTs', 'num'], 5: ['lastGlobalId', 'id'], 6: ['lastClientId', 'id'] }, true],
}

export type SyncAttach = { type?: string; action?: string; params?: string; title?: string; href?: string; thumb?: string; description?: string; catId?: number; id?: number; childNumber?: number; zinstantData?: string; zinstantMsg?: string; [k: string]: unknown }
export type SyncMeta = {
  attachs?: SyncAttach[]
  mentions?: { uid: string; pos: number; len: number; type: number }[]
  reference?: { type: number; data: string }
  quote?: { attach?: string; ownerId: string; ts: number; fromD?: string; cliMsgId: number; globalMsgId: string; msg?: string; cliMsgType: number; ttl?: number; partialQuote?: string }
  property?: { size?: number; color?: number; type?: number; subType?: number; ext?: string }
  ttl?: number
}
export type SyncMessage = { senderId: string; clientId: string; msgStatus: number; msgType: number; timestamp: number; globalId: string; content: string; meta?: SyncMeta }
export type SyncConversation = { convId: string; convType: number; respondedByMe: boolean; lastTs: number; lastGlobalId: string; lastClientId: string }

function decode(buf: Uint8Array, schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let at = 0
  const varint = () => {
    let v = 0n
    for (let shift = 0n; ; shift += 7n) {
      const b = buf[at++]
      if (b === undefined) throw new Error('protobuf: truncated varint')
      v |= BigInt(b & 0x7f) << shift
      if (b < 0x80) return v
    }
  }
  while (at < buf.length) {
    const key = Number(varint())
    const [name, kind, repeated] = schema[key >>> 3] ?? []
    let value: unknown
    switch (key & 7) {
      case 0: {
        const v = varint()
        value = kind === 'id' ? BigInt.asUintN(64, v).toString() : kind === 'bool' ? v !== 0n : Number(BigInt.asIntN(64, v))
        break
      }
      case 2: {
        const n = Number(varint())
        const bytes = buf.subarray(at, (at += n))
        value = typeof kind === 'object' ? decode(bytes, kind) : new TextDecoder().decode(bytes)
        break
      }
      case 1:
        at += 8
        continue
      case 5:
        at += 4
        continue
      default:
        throw new Error(`protobuf: wire type ${key & 7}`)
    }
    if (!name) continue
    if (repeated) ((out[name] ??= []) as unknown[]).push(value)
    else out[name] = value
  }
  // proto3 leaves zero values off the wire (a text message has no msgType): fill them in as toObject does
  for (const [name, kind, repeated] of Object.values(schema))
    if (!(name in out) && !repeated && typeof kind === 'string') out[name] = kind === 'str' ? '' : kind === 'id' ? '0' : kind === 'bool' ? false : 0
  return out
}

export const decodeMessages = (b: Uint8Array) => (decode(b, MessageChunk).partitions ?? []) as { id: string; messages?: SyncMessage[] }[]
export const decodeConversations = (b: Uint8Array) => (decode(b, ConversationChunk).conversations ?? []) as SyncConversation[]
