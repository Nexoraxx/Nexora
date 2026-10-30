import type { AutoReplyRequest } from '../../dtos/requests/auto-reply.request'
import type { AutoReply } from '../../dtos/responses/auto-reply.response'

export default interface IAutoReplyService {
  list(accountId: string): Promise<{ rules: AutoReply[]; enabled: boolean; maxRules: number; maxActive: number }>
  create(accountId: string, rule: AutoReplyRequest): Promise<void>
  update(accountId: string, id: number, rule: AutoReplyRequest): Promise<void>
  setEnabled(accountId: string, id: number, enable: boolean): Promise<void>
  remove(accountId: string, id: number): Promise<void>
}
