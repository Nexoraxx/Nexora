import { inject, injectable } from 'inversify'
import { Database } from '../../../../dbs/sqlite'
import { TOKENS } from '../../../../di/tokens'
import type IConversationRepository from '../interfaces/conversation-repository'

@injectable()
export default class ConversationRepository implements IConversationRepository {
  constructor(@inject(TOKENS.Database) private db: Database) {}

  lastMessage(accountId: string, threadId: string) {
    return this.db
      .query<{ cliMsgId: string | null; fromUid: string }, [string, string]>(
        `SELECT cliMsgId, fromUid FROM message WHERE accountId = ? AND toUid = ? AND fromUid IS NOT NULL ORDER BY sendDttm DESC LIMIT 1`,
      )
      .get(accountId, threadId)
  }
}
