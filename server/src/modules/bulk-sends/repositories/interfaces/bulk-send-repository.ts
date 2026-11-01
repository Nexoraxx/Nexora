import type { BulkSend, BulkSendState, BulkTemplate, Recipient, RecipientState } from '../../dtos/responses/bulk-send.response'
import type { Friend, Next } from '../../models/bulk-send.model'

export default interface IBulkSendRepository {
  templates(): BulkTemplate[]
  createTemplate(name: string, body: string): number
  // false when there's no such template
  updateTemplate(id: number, name: string, body: string): boolean
  removeTemplate(id: number): void

  // the account's friends among userIds (blocked ones left out), in userIds' order
  friends(accountId: string, userIds: string[]): Friend[]
  accountName(accountId: string): string

  sends(accountId: string): BulkSend[]
  send(accountId: string, id: number): BulkSend | null
  state(id: number): { accountId: string; state: BulkSendState } | null
  // another of this account's runs that is going now
  runningOther(accountId: string, id?: number): boolean
  create(accountId: string, name: string, recipients: { userId: string; text: string }[]): number
  recipients(sendId: number): Recipient[]
  setState(id: number, state: BulkSendState, pauseReason?: string | null): void
  // the next one in line of a running run, else null
  next(sendId: number): Next | null
  mark(sendId: number, userId: string, state: RecipientState, extra?: { error?: string; msgId?: string; sentAt?: number }): void
  // cancel: who's still waiting is skipped
  skipPending(sendId: number): void
  // at start: runs left running pause, a send cut off mid-call becomes 'unknown'; returns the runs paused
  recover(reason: string): number[]
}
