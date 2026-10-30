import type { TodoPerson } from '../../dtos/responses/todo.response'

export default interface ITodoRepository {
  message(accountId: string, msgId: string): { cliMsgId: string | null; fromUid: string | null; msgType: string; mentions: string | null } | null
  cliMsgId(accountId: string, msgId: string): { cliMsgId: string | null } | null
  names(accountId: string, table: 'user' | 'groups', ids: string[]): TodoPerson[]
}
