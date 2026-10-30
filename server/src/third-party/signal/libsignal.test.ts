import { describe, expect, it } from 'bun:test'
import { getLibSignal, deriveIdentityKeyPair } from './libsignal'

describe('Signal Protocol Runtime', () => {
  it('loads libsignal runtime with all expected modules', () => {
    const lib = getLibSignal()
    expect(lib).toBeDefined()
    expect(lib.KeyHelper).toBeDefined()
    expect(lib.SignalProtocolAddress).toBeDefined()
    expect(lib.SessionBuilder).toBeDefined()
    expect(lib.SessionCipher).toBeDefined()
  })

  it('derives deterministic identity key from uid and deviceId', async () => {
    const kp1 = await deriveIdentityKeyPair('123456', 2)
    const kp2 = await deriveIdentityKeyPair('123456', 2)
    expect(Buffer.from(kp1.pubKey).toString('base64')).toBe(Buffer.from(kp2.pubKey).toString('base64'))
    expect(Buffer.from(kp1.privKey).toString('base64')).toBe(Buffer.from(kp2.privKey).toString('base64'))
    expect(kp1.pubKey.byteLength).toBe(33)
    expect(kp1.privKey.byteLength).toBe(32)
  })
})
