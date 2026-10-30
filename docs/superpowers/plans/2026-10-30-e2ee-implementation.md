# Zalo E2EE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full Zalo PC v26.10.20-compatible End-to-End Encryption (E2EE 1-1) in Nexora, enabling encrypted messaging, key management, signaling, and session handshakes.

**Architecture:** The local Bun server hosts the modified Signal v3 runtime (`libsignal-protocol.static.js`), managing keys in local SQLite tables (`e2ee_*`). A WebSocket RPC manager interfaces with Zalo's chat socket for Signal bundle and handshake commands (cmds 540-564), while encrypted messages are sent via HTTP `chat_e2e` and received via WebSocket cmd 551. Decrypted plaintexts are stored in SQLite and streamed to the React/Tauri frontend.

**Tech Stack:** Bun, TypeScript, SQLite, `@hwqnq/zca-js`, WebSocket (`ws`), libsignal-protocol v3, React, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-10-30-e2ee-design.md`

## Global Constraints
- Target device ID: `2` (PC platform type).
- Identity Key derivation: `clamp(SHA-256("${uid}:2"))`.
- Wire format: Signal Protocol v3 (`0x33`), with HKDF info tags `"ZaloText"`, `"ZaloRatchet"`, `"ZaloMessageKeys"`.
- All Signal private keys remain in server-side SQLite (`e2ee_*` tables); never expose private keys over HTTP or to frontend.
- Group E2EE is strictly out of scope per Zalo PC v26.10.20 (`DEACTIVATE_E2EE_GROUP = true`).
- Plaintext chats must remain 100% operational with zero regression.

## Review Focus
1. **Key ID mismatch on incoming message:** Message contains unknown `iid` or counter error → Must map to deciphered cache or error code 3000 without crashing the listener.
2. **Duplicate message reception:** Duplicate `cliMsgId` / message received twice → Must resolve from `e2ee_deciphered` table to avoid Signal `MessageCounterError`.
3. **Multi-device recipient fan-out:** Peer has multiple devices (mobile, web, PC) → Encrypts separately for each device's session; missing session initiates bundle fetch.
4. **First-time / missing server bundle:** `GET_KEY_ID (564)` returns `-1` or mismatch → Automatically generates bundle (20 OPKs + signed prekey) and submits via `SUBMIT_BUNDLE (540)`.
5. **Session ACK timeout:** Outgoing session init `543` waiting for `544` ack → Handle waiting state gracefully without permanently freezing outgoing queue.

---

### Task 1: Signal Protocol Runtime & Key Derivation

**Files:**
- Create: `server/src/third-party/signal/libsignal.ts`
- Create: `server/src/third-party/signal/crypto.ts`
- Test: `server/src/third-party/signal/libsignal.test.ts`

**Interfaces:**
- Consumes: `/media/Data/github.com/Nexoraxx/Client/reverse/pc-dist/libs/libsignal-protocol.static.js`
- Produces: `libsignal` object (`KeyHelper`, `SignalProtocolAddress`, `SessionBuilder`, `SessionCipher`, `Curve`), `deriveIdentityKeyPair(uid: string, deviceId?: number): KeyPair`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/third-party/signal/libsignal.test.ts
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

  it('derives deterministic identity key from uid and deviceId', () => {
    const kp1 = deriveIdentityKeyPair('123456', 2)
    const kp2 = deriveIdentityKeyPair('123456', 2)
    expect(Buffer.from(kp1.pubKey).toString('base64')).toBe(Buffer.from(kp2.pubKey).toString('base64'))
    expect(Buffer.from(kp1.privKey).toString('base64')).toBe(Buffer.from(kp2.privKey).toString('base64'))
    expect(kp1.pubKey.byteLength).toBe(33)
    expect(kp1.privKey.byteLength).toBe(32)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/src/third-party/signal/libsignal.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `libsignal.ts` and `crypto.ts`**

Load `libsignal-protocol.static.js` cleanly in Bun with a synthetic global sandbox, and implement `deriveIdentityKeyPair(uid, deviceId = 2)` using `crypto.createHash('sha256').update('${uid}:${deviceId}').digest()` with Curve25519 clamping.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/src/third-party/signal/libsignal.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/third-party/signal/libsignal.ts server/src/third-party/signal/crypto.ts server/src/third-party/signal/libsignal.test.ts
git commit -m "feat(e2ee): add libsignal runtime wrapper and deterministic identity key derivation"
```

---

### Task 2: SQLite Signal Protocol Store

**Files:**
- Create: `server/src/third-party/signal/signal-store.ts`
- Test: `server/src/third-party/signal/signal-store.test.ts`

**Interfaces:**
- Consumes: `libsignal.ts`, `server/src/dbs/sqlite.ts`
- Produces: `SignalSqliteStore` implementing `libsignal` store interface:
  - `getIdentityKeyPair(): Promise<KeyPair>`
  - `getLocalRegistrationId(): Promise<number>`
  - `saveIdentity(identifier: string, identityKey: ArrayBuffer): Promise<boolean>`
  - `isTrustedIdentity(identifier: string, identityKey: ArrayBuffer): Promise<boolean>` (always true)
  - `loadPreKey(keyId: number): Promise<KeyPair | undefined>`
  - `storePreKey(keyId: number, keyPair: KeyPair): Promise<void>`
  - `removePreKey(keyId: number): Promise<void>`
  - `loadSignedPreKey(keyId: number): Promise<KeyPair | undefined>`
  - `storeSignedPreKey(keyId: number, keyPair: KeyPair): Promise<void>`
  - `removeSignedPreKey(keyId: number): Promise<void>`
  - `loadSession(identifier: string): Promise<string | undefined>`
  - `storeSession(identifier: string, record: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/third-party/signal/signal-store.test.ts
import { describe, expect, it } from 'bun:test'
import { Database } from '../../dbs/sqlite'
import { SignalSqliteStore } from './signal-store'
import { deriveIdentityKeyPair } from './libsignal'

describe('SignalSqliteStore', () => {
  it('stores and retrieves identity, prekeys, signed prekeys and sessions', async () => {
    const db = new Database(':memory:')
    const accountId = 'user_1'
    const store = new SignalSqliteStore(db, accountId)

    const identity = deriveIdentityKeyPair(accountId, 2)
    await store.saveIdentityKeyPair(identity, 12345)
    expect(await store.getLocalRegistrationId()).toBe(12345)
    const loadedId = await store.getIdentityKeyPair()
    expect(Buffer.from(loadedId.pubKey).toString('hex')).toBe(Buffer.from(identity.pubKey).toString('hex'))

    await store.storePreKey(101, identity)
    const pk = await store.loadPreKey(101)
    expect(pk).toBeDefined()
    await store.removePreKey(101)
    expect(await store.loadPreKey(101)).toBeUndefined()

    await store.storeSession('peer_1.2', 'session_data_json')
    expect(await store.loadSession('peer_1.2')).toBe('session_data_json')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/src/third-party/signal/signal-store.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `SignalSqliteStore` in `signal-store.ts`**

Map store methods directly to queries on `e2ee_identity`, `e2ee_registration`, `e2ee_prekey`, `e2ee_signed_prekey`, `e2ee_session`, and `e2ee_deciphered` with `accountId` partition. Ensure JSON serialization of buffers as expected by libsignal-protocol-javascript.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/src/third-party/signal/signal-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/third-party/signal/signal-store.ts server/src/third-party/signal/signal-store.test.ts
git commit -m "feat(e2ee): implement SignalSqliteStore backed by SQLite tables"
```

---

### Task 3: WebSocket Signal RPC Layer

**Files:**
- Create: `server/src/third-party/signal/signal-server-manager.ts`
- Test: `server/src/third-party/signal/signal-server-manager.test.ts`

**Interfaces:**
- Consumes: `ws` socket from `zca.listener`, `server/src/third-party/zalo/controls.ts`
- Produces: `SignalServerManager`:
  - `sendRpc<T>(cmd: number, data: unknown, timeoutMs?: number): Promise<T>`
  - `getKeyId(): Promise<{ keyId: number; submitTs: number } | null>`
  - `submitBundle(bundle: object): Promise<{ ts: number }>`
  - `submitPreKeys(preKeys: object): Promise<{ ts: number }>`
  - `getBundle(uids: { uid: string; deviceId: number }[]): Promise<BundleResponse>`
  - `initSession(uidTo: string, data: object[]): Promise<void>`
  - Event emitter for pushes: `request_prekeys` (cmd 549), `notify_delete_key` (cmd 548), `disable` (cmd 580), `enable` (cmd 581)

- [ ] **Step 1: Write the failing test**

```ts
// server/src/third-party/signal/signal-server-manager.test.ts
import { describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import { SignalServerManager } from './signal-server-manager'

describe('SignalServerManager', () => {
  it('encodes RPC frame and resolves matching response', async () => {
    const fakeWs = new EventEmitter() as any
    fakeWs.send = (buf: Buffer) => {
      // simulate server reply: header version 1, cmd 564 LE, subCmd 0
      const payload = JSON.parse(buf.subarray(4).toString('utf8'))
      const resPayload = {
        cmd: 564,
        subCmd: 0,
        data: { reqId: payload.data.reqId, data: { keyId: 4321, submitTs: 1000 } }
      }
      const resHeader = Buffer.alloc(4)
      resHeader[0] = 1
      resHeader.writeUInt16LE(564, 1)
      resHeader[3] = 0
      const resBuf = Buffer.concat([resHeader, Buffer.from(JSON.stringify(resPayload))])
      setTimeout(() => fakeWs.emit('message', resBuf), 10)
    }

    const manager = new SignalServerManager(fakeWs)
    const keyInfo = await manager.getKeyId()
    expect(keyInfo).toEqual({ keyId: 4321, submitTs: 1000 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/src/third-party/signal/signal-server-manager.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `SignalServerManager`**

Handle binary packet framing `[u8 1][u16 LE cmd][u8 0][JSON]`, request tracking with `signal_req_${n++}`, timeouts, and dispatching pushes (cmds 549, 548, 580, 581).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/src/third-party/signal/signal-server-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/third-party/signal/signal-server-manager.ts server/src/third-party/signal/signal-server-manager.test.ts
git commit -m "feat(e2ee): implement SignalServerManager for WebSocket RPC signalling"
```

---

### Task 4: Bundle Registration & Handshake Orchestration

**Files:**
- Create: `server/src/third-party/signal/e2ee-session-manager.ts`
- Test: `server/src/third-party/signal/e2ee-session-manager.test.ts`

**Interfaces:**
- Consumes: `libsignal.ts`, `SignalSqliteStore`, `SignalServerManager`
- Produces: `E2eeSessionManager`:
  - `ensureRegistered(): Promise<void>`
  - `getOrBuildSessions(peerUid: string): Promise<string[]>` (returns list of active device addresses)
  - `handleIncomingInitSession(fromUid: string, data: any[]): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/third-party/signal/e2ee-session-manager.test.ts
import { describe, expect, it } from 'bun:test'
import { Database } from '../../dbs/sqlite'
import { SignalSqliteStore } from './signal-store'
import { E2eeSessionManager } from './e2ee-session-manager'

describe('E2eeSessionManager', () => {
  it('registers bundle when server has no key or mismatched keyId', async () => {
    const db = new Database(':memory:')
    const store = new SignalSqliteStore(db, 'user_test')
    let bundleSubmitted: any = null
    const fakeRpc = {
      getKeyId: async () => null, // err -1: no key
      submitBundle: async (bundle: any) => {
        bundleSubmitted = bundle
        return { ts: Date.now() }
      }
    } as any

    const sessionManager = new E2eeSessionManager('user_test', store, fakeRpc)
    await sessionManager.ensureRegistered()

    expect(bundleSubmitted).toBeDefined()
    expect(bundleSubmitted.key.deviceId).toBe(2)
    expect(bundleSubmitted.key.opKeys.length).toBe(20)
    expect(await store.getLocalRegistrationId()).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/src/third-party/signal/e2ee-session-manager.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `E2eeSessionManager`**

Implement bundle generation (`registrationId`, 1 `signedPreKey`, 20 `opKeys`), `ensureRegistered` check against `getKeyId`, prekey replenishment upon cmd 549, and building pairwise sessions using `getBundle` and `SessionBuilder.processPreKey`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/src/third-party/signal/e2ee-session-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/third-party/signal/e2ee-session-manager.ts server/src/third-party/signal/e2ee-session-manager.test.ts
git commit -m "feat(e2ee): implement bundle registration and session handshake orchestrator"
```

---

### Task 5: 1-1 E2EE Outgoing Message Encryption & Sending

**Files:**
- Create: `server/src/third-party/signal/e2ee-message-sender.ts`
- Test: `server/src/third-party/signal/e2ee-message-sender.test.ts`

**Interfaces:**
- Consumes: `libsignal.ts`, `SignalSqliteStore`, `E2eeSessionManager`, `server/src/third-party/zalo/post.ts`
- Produces: `E2eeMessageSender`:
  - `sendTextMessage(api: API, peerUid: string, text: string, options?: { quote?: any; clientId?: string }): Promise<any>`
  - `encryptField(address: SignalProtocolAddress, plaintext: string): Promise<string>`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/third-party/signal/e2ee-message-sender.test.ts
import { describe, expect, it } from 'bun:test'
import { Database } from '../../dbs/sqlite'
import { SignalSqliteStore } from './signal-store'
import { E2eeMessageSender } from './e2ee-message-sender'

describe('E2eeMessageSender', () => {
  it('constructs multi-device listParams with base64 ciphertext', async () => {
    const db = new Database(':memory:')
    const store = new SignalSqliteStore(db, 'sender_1')
    // setup session with peer_1.2
    const fakeSessionMgr = {
      getOrBuildSessions: async (uid: string) => [`${uid}_2.2`]
    } as any

    const sender = new E2eeMessageSender('sender_1', store, fakeSessionMgr)
    // mock encryptField
    sender.encryptField = async () => 'base64ciphertext'

    let postedParams: any = null
    const fakeApi = {} as any
    sender.postHttp = async (api: any, path: string, params: any) => {
      postedParams = params
      return { data: { msgId: '12345' } }
    }

    const res = await sender.sendTextMessage(fakeApi, 'peer_1', 'Hello E2EE')
    expect(res).toBeDefined()
    const listParams = JSON.parse(postedParams.listParams)
    expect(listParams).toHaveLength(1)
    expect(listParams[0].toId).toBe('peer_1')
    expect(listParams[0].platform).toBe(2)
    expect(listParams[0].message).toBe('base64ciphertext')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/src/third-party/signal/e2ee-message-sender.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `E2eeMessageSender`**

Encrypt each target device's payload using `SessionCipher.encrypt`, format `listParams`, package `destType: 3`, and call `zaloPost(api, 'chat_e2e', '/api/e2ee/pc/message/sms', ...)`. Save `sha256` hash in `e2ee_hash` for resend v3.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/src/third-party/signal/e2ee-message-sender.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/third-party/signal/e2ee-message-sender.ts server/src/third-party/signal/e2ee-message-sender.test.ts
git commit -m "feat(e2ee): implement E2eeMessageSender for 1-1 encrypted message fan-out"
```

---

### Task 6: 1-1 E2EE Incoming Message Decryption

**Files:**
- Create: `server/src/third-party/signal/e2ee-message-receiver.ts`
- Test: `server/src/third-party/signal/e2ee-message-receiver.test.ts`

**Interfaces:**
- Consumes: `libsignal.ts`, `SignalSqliteStore`, `e2ee_deciphered`
- Produces: `E2eeMessageReceiver`:
  - `decryptIncomingMessage(msgData: any): Promise<{ plainText: string; e2eeStatus: number }>`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/third-party/signal/e2ee-message-receiver.test.ts
import { describe, expect, it } from 'bun:test'
import { Database } from '../../dbs/sqlite'
import { SignalSqliteStore } from './signal-store'
import { E2eeMessageReceiver } from './e2ee-message-receiver'

describe('E2eeMessageReceiver', () => {
  it('returns cached plainText on duplicate message without error', async () => {
    const db = new Database(':memory:')
    const store = new SignalSqliteStore(db, 'rec_1')
    await store.saveDeciphered('msg_100_peer_1', 'cached message')

    const receiver = new E2eeMessageReceiver('rec_1', store)
    const result = await receiver.decryptIncomingMessage({
      cliMsgId: 'msg_100',
      uidFrom: 'peer_1',
      idTo: 'rec_1',
      content: 'raw_cipher'
    })
    expect(result.plainText).toBe('cached message')
    expect(result.e2eeStatus).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/src/third-party/signal/e2ee-message-receiver.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `E2eeMessageReceiver`**

Parse base64 payload, check type (1 = WhisperMessage, 3 = PreKeyWhisperMessage), invoke `SessionCipher.decryptWhisperMessage` / `decryptPreKeyWhisperMessage`, cache plaintext in `e2ee_deciphered`, and return decrypted content with `e2eeStatus = 1`. Handle errors gracefully with code 3000 ("Giải mã tin nhắn không thành công").

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/src/third-party/signal/e2ee-message-receiver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/third-party/signal/e2ee-message-receiver.ts server/src/third-party/signal/e2ee-message-receiver.test.ts
git commit -m "feat(e2ee): implement E2eeMessageReceiver with deciphered cache and fallback"
```

---

### Task 7: Full Integration into `ZcaService` & `MessageService`

**Files:**
- Modify: `server/src/third-party/zalo/zalo-client.ts`
- Modify: `server/src/modules/messages/services/implements/message-service.ts`
- Test: `server/src/modules/messages/messages.test.ts`

**Interfaces:**
- Consumes: Tasks 1-6
- Produces: Integrated E2EE sending and receiving in Nexora core:
  - Account attach initializes E2EE and bundles.
  - Incoming cmd 551 decrypted into `message` table.
  - Outgoing message automatically uses E2EE if conversation is marked E2EE.

- [ ] **Step 1: Write integration test in `messages.test.ts`**

Add test case checking that cmd 551 message row is decrypted and stored with `msgType = 'webchat'`, `msgText = decrypted`, and `e2eeStatus = 1`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/src/modules/messages/messages.test.ts`
Expected: FAIL

- [ ] **Step 3: Wire E2EE pipeline into `zalo-client.ts` and `message-service.ts`**

Attach `SignalServerManager`, `E2eeSessionManager`, `E2eeMessageSender`, and `E2eeMessageReceiver` per connected account. Intercept cmd 551 frames from WebSocket, route outgoing messages in E2EE threads through `E2eeMessageSender`.

- [ ] **Step 4: Run all server tests to verify pass**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/third-party/zalo/zalo-client.ts server/src/modules/messages/services/implements/message-service.ts server/src/modules/messages/messages.test.ts
git commit -m "feat(e2ee): wire full E2EE flow into ZcaService and MessageService"
```

---

### Task 8: Frontend UI E2EE Indicator & Experience

**Files:**
- Modify: `apps/Nexora/src/` (conversation list item & chat header components)
- Test: UI component verification / build

**Interfaces:**
- Consumes: `e2eeStatus` from message API and conversation info
- Produces: E2EE lock icon badge next to thread name, "Mã hóa đầu cuối" banner in chat header.

- [ ] **Step 1: Locate conversation and header components**

Inspect `apps/Nexora/src/` for conversation items and chat header.

- [ ] **Step 2: Add E2EE lock badge and tooltip**

Display standard lock icon (`<Lock className="w-3.5 h-3.5 text-emerald-600" />`) and "Mã hóa đầu cuối" badge when thread has `e2ee = 1` or message has `e2eeStatus = 1`.

- [ ] **Step 3: Build frontend to verify no errors**

Run: `cd apps/Nexora && bun run build`
Expected: Build succeeds with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/Nexora/src/
git commit -m "feat(ui): display E2EE badges and encryption status in conversation list and header"
```
