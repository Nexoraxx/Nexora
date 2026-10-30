import type { PinRequest } from '../../dtos/requests/pin.request'
import type { Pin } from '../../dtos/responses/pin.response'

export default interface IPinService {
  list(accountId: string, threadId: string): Promise<{ pins: Pin[]; limit: number }>
  pin(accountId: string, threadId: string, body: PinRequest): Promise<void>
  unpin(accountId: string, threadId: string, topicId: string, topicType: number): Promise<void>
}
