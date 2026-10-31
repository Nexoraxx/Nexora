import type { Variable } from '../../services/implements/template'

export type BulkTemplate = { id: number; name: string; body: string; updatedAt: number }
export type BulkSendState = 'running' | 'paused' | 'done' | 'cancelled'
export type RecipientState = 'pending' | 'sending' | 'sent' | 'failed' | 'unknown' | 'skipped'
export type BulkSend = {
  id: number
  accountId: string
  name: string
  state: BulkSendState
  pauseReason: string | null
  createdAt: number
  total: number
  sent: number
  failed: number
  // not gone through yet
  pending: number
}
export type Recipient = { userId: string; name: string; avatar: string; text: string; state: RecipientState; error: string | null; sentAt: number | null }
// missing: per variable the body uses, who has no value for it
export type Preview = { items: { userId: string; name: string; text: string }[]; missing: Partial<Record<Variable, string[]>> }
