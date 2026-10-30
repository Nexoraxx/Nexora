export function toBase64(abOrBuf: ArrayBuffer | Buffer): string {
  return Buffer.from(abOrBuf as ArrayBuffer).toString('base64')
}

export function fromBase64(base64: string): ArrayBuffer {
  const buf = Buffer.from(base64, 'base64')
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}
