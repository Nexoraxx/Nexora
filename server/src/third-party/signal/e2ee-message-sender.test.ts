import { describe, expect, it } from 'bun:test'
import { openDatabase } from '../../dbs/sqlite'
import { SignalSqliteStore } from './signal-store'
import { E2eeMessageSender } from './e2ee-message-sender'

describe('E2eeMessageSender', () => {
  it('constructs multi-device listParams with base64 ciphertext and posts to chat_e2e', async () => {
    const db = openDatabase(':memory:')
    db.run(
      `INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('sender_1', 'Sender', 'imei1', '{}', 'agent', 1000)`
    )
    const store = new SignalSqliteStore(db, 'sender_1')
    await store.saveIdentityKeyPair(
      { pubKey: new ArrayBuffer(33), privKey: new ArrayBuffer(32) },
      9999
    )

    const fakeSessionMgr = {
      getOrBuildSessions: async (uid: string) => [`${uid}_2.2`],
    } as any

    const sender = new E2eeMessageSender('sender_1', store, fakeSessionMgr)
    sender.encryptField = async () => 'base64ciphertext'

    let postedPath = ''
    let postedParams: any = null
    const fakeApi = {} as any
    sender.postHttp = async (_api: any, path: string, params: any) => {
      postedPath = path
      postedParams = params
      return { data: { msgId: '12345' } }
    }

    const res = await sender.sendTextMessage(fakeApi, 'peer_1', 'Hello E2EE')
    expect(res).toBeDefined()
    expect(postedPath).toBe('/api/e2ee/pc/message/sms')
    expect(postedParams.destType).toBe(3)
    expect(postedParams.threadId).toBe('peer_1')

    const listParams = JSON.parse(postedParams.listParams)
    expect(listParams).toHaveLength(1)
    expect(listParams[0].toId).toBe('peer_1')
    expect(listParams[0].platform).toBe(2)
    expect(listParams[0].message).toBe('base64ciphertext')

    const e2eeExt = JSON.parse(listParams[0].e2eeExt)
    expect(e2eeExt.sender_iid).toBe(9999)
  })
})
