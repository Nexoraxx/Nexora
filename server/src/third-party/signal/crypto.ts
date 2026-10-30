export function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

export function arrayBufferToBuffer(ab: ArrayBuffer): Buffer {
  return Buffer.from(ab)
}

export function toBase64(abOrBuf: ArrayBuffer | Buffer): string {
  if (Buffer.isBuffer(abOrBuf)) return abOrBuf.toString('base64')
  return Buffer.from(abOrBuf).toString('base64')
}

export function fromBase64(base64: string): ArrayBuffer {
  const buf = Buffer.from(base64, 'base64')
  return bufferToArrayBuffer(buf)
}
