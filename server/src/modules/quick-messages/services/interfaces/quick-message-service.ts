import type { QuickMessageRequest } from '../../dtos/requests/quick-message.request'
import type { QuickMessage } from '../../dtos/responses/quick-message.response'

export default interface IQuickMessageService {
  list(accountId: string): Promise<{ items: QuickMessage[]; max: number }>
  create(accountId: string, body: QuickMessageRequest): Promise<void>
  update(accountId: string, id: string, body: QuickMessageRequest): Promise<void>
  remove(accountId: string, id: string): Promise<void>
}
