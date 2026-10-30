import { describe, expect, it } from 'bun:test'
import { openDatabase } from '../../dbs/sqlite'
import { SignalSqliteStore } from './signal-store'
import { E2eeMessageReceiver } from './e2ee-message-receiver'

describe('E2eeMessageReceiver', () => {
  it('returns cached plainText on duplicate message without error', async () => {
    const db = openDatabase(':memory:')
    db.run(
      `INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('rec_1', 'Receiver', 'imei1', '{}', 'agent', 1000)`
    )
    const store = new SignalSqliteStore(db, 'rec_1')
    await store.saveDeciphered('msg_100_peer_1_rec_1', 'cached secret message')

    const receiver = new E2eeMessageReceiver('rec_1', store)
    const result = await receiver.decryptIncomingMessage({
      cliMsgId: 'msg_100',
      uidFrom: 'peer_1',
      idTo: 'rec_1',
      content: 'dummy_cipher',
    })

    expect(result.plainText).toBe('cached secret message')
    expect(result.e2eeStatus).toBe(1)
  })

  it('handles decryption failure gracefully with e2eeStatus 3000', async () => {
    const db = openDatabase(':memory:')
    db.run(
      `INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('rec_1', 'Receiver', 'imei1', '{}', 'agent', 1000)`
    )
    const store = new SignalSqliteStore(db, 'rec_1')
    const receiver = new E2eeMessageReceiver('rec_1', store)

    const result = await receiver.decryptIncomingMessage({
      cliMsgId: 'msg_unknown',
      uidFrom: 'peer_unknown',
      idTo: 'rec_1',
      content: Buffer.from([1, 2, 3, 4, 5]).toString('base64'),
    })

    expect(result.plainText).toBe('Giải mã tin nhắn không thành công')
    expect(result.e2eeStatus).toBe(3000)
    expect(result.error).toBeDefined()
  })
})
