import { createDecipheriv } from 'node:crypto'

// Zalo PC's per-message-type E2EE field model. One encrypted message carries an ordered list of cipher fields; which
// content fields they are, and in what order, comes from PC's extractTextContentFromServer / decryptMsgFromServer.
// The same spec drives both directions: on send each field is a plaintext to encrypt, on receive each is a Signal
// ciphertext to decrypt. Media (photo/file/voice/video/doodle) hide the cipher inside the href's e2esession= param;
// stickers encode their numeric ids as 4-byte little-endian buffers; everything else is a plain string field.

// msgType string -> the content type whose field spec applies (PC's normalizeMessageType, encrypted types only)
export const CONTENT_TYPE: Record<string, string> = {
  webchat: 'text',
  'chat.photo': 'photo',
  'share.file': 'file',
  'chat.voice': 'voice',
  'chat.video.msg': 'video',
  'chat.doodle': 'doodle',
  'chat.gif': 'gif',
  'chat.location.new': 'location',
  'chat.sticker': 'sticker',
  'chat.recommended': 'contact',
}

export const normalizeType = (msgType: string) => CONTENT_TYPE[msgType]

// plain: the field value is the cipher as-is. key: the cipher lives in the href's e2esession= param (media upload
// link). num: the plaintext is a 4-byte little-endian integer (sticker ids). opt: only present when content[name] is.
export type FieldKind = 'plain' | 'key' | 'num'
export type Field = { name: string; kind: FieldKind; opt?: boolean }

// ordered content fields per type, matching PC's extractTextContentFromServer push order (mentions + reference.data
// are appended generically by the caller; text and contact are handled on their own because of quotes / sub-actions)
export const FIELD_SPECS: Record<string, Field[]> = {
  photo: [
    { name: 'href', kind: 'key' },
    { name: 'params', kind: 'plain' },
    { name: 'thumb', kind: 'key' },
    { name: 'title', kind: 'plain' },
    { name: 'description', kind: 'plain' },
  ],
  file: [
    { name: 'href', kind: 'key' },
    { name: 'params', kind: 'plain' },
    { name: 'title', kind: 'plain' },
    { name: 'thumb', kind: 'key' },
    { name: 'description', kind: 'plain' },
    { name: 'type', kind: 'plain' },
  ],
  voice: [
    { name: 'href', kind: 'key' },
    { name: 'params', kind: 'plain' },
  ],
  video: [
    { name: 'href', kind: 'key' },
    { name: 'params', kind: 'plain' },
    { name: 'thumb', kind: 'key' },
    { name: 'title', kind: 'plain', opt: true },
  ],
  doodle: [
    { name: 'href', kind: 'key' },
    { name: 'params', kind: 'plain' },
  ],
  // GIF href/thumb are plain strings, not e2ee upload links
  gif: [
    { name: 'href', kind: 'plain' },
    { name: 'params', kind: 'plain' },
    { name: 'title', kind: 'plain' },
    { name: 'thumb', kind: 'plain' },
    { name: 'description', kind: 'plain' },
    { name: 'type', kind: 'plain' },
  ],
  location: [
    { name: 'description', kind: 'plain' },
    { name: 'params', kind: 'plain' },
    { name: 'title', kind: 'plain' },
  ],
  sticker: [
    { name: 'id', kind: 'num' },
    { name: 'catId', kind: 'num' },
    { name: 'type', kind: 'num' },
  ],
}

// ===== media upload link (e2esession= carries the Signal ciphertext of the real AES key) =====
const KEY_RE = /e2esession(=([^#]*)|&|#|$)/

export const getBase64Key = (url: unknown): string => {
  if (typeof url !== 'string' || !url) return ''
  try {
    return KEY_RE.exec(new URL(url).search)?.[2] ?? ''
  } catch {
    return ''
  }
}

export const isE2eeUploadLink = (url: unknown): boolean => !!getBase64Key(url)

export const updateBase64Key = (url: string, key: string): string => (url && key ? url.replace(KEY_RE, `e2esession=${key}`) : '')

// ===== sticker numeric fields: 4-byte little-endian =====
export const numberToBuffer = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0, 0)
  return b
}

export const bufferToNumber = (b: Buffer): number => (b.length >= 4 ? b.readUInt32LE(0) : 0)

// ===== media blob decryption (the AES key lives in the decrypted href's e2esession= param) =====
// PC's _getAesKeyFromBase64: e2esession decodes to key(32) ‖ iv ‖ tag. LINEAR (photos) = AES-256-GCM, iv 12, tag 16.
// version=2 = BLOCK_BY_BLOCK (video/voice) = AES-256-CTR, iv 16, no tag, 4096-byte blocks.
export type MediaKey = { key: Buffer; iv: Buffer; tag?: Buffer; block: boolean }
const KEY_LEN = 32

// Read one query param from the raw URL without URLSearchParams (which would turn base64 '+' into a space)
const rawParam = (url: string, name: string) => new RegExp(`[?&]${name}=([^&#]*)`).exec(url)?.[1]

export const parseE2eeKey = (url: string): MediaKey | null => {
  const b64 = rawParam(url, 'e2esession')
  if (!b64) return null
  const block = rawParam(url, 'version') === '2'
  const raw = Buffer.from(b64, 'base64')
  const ivLen = block ? 16 : 12
  if (raw.length < KEY_LEN + ivLen) return null
  return {
    key: raw.subarray(0, KEY_LEN),
    iv: raw.subarray(KEY_LEN, KEY_LEN + ivLen),
    tag: block ? undefined : raw.subarray(KEY_LEN + ivLen),
    block,
  }
}

// the CDN serves the encrypted blob at the path; the e2esession/version params are client-side key material
export const stripE2eeParams = (url: string) => {
  const [base, query] = url.split('?')
  if (!query) return base
  const kept = query.split('&').filter((p) => !/^(e2esession|version)=/.test(p))
  return kept.length ? `${base}?${kept.join('&')}` : base
}

export const decryptE2eeMedia = (data: Buffer, k: MediaKey): Buffer => {
  if (k.block) {
    // AES-256-CTR streams the whole file with the 16-byte iv as the initial counter
    const d = createDecipheriv('aes-256-ctr', k.key, k.iv)
    return Buffer.concat([d.update(data), d.final()])
  }
  // AES-256-GCM: web crypto appends the tag to the ciphertext; Node takes it via setAuthTag
  const d = createDecipheriv('aes-256-gcm', k.key, k.iv)
  if (k.tag) d.setAuthTag(k.tag)
  return Buffer.concat([d.update(data), d.final()])
}
