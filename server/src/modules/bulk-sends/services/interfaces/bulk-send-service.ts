import type { CreateBulkSendRequest, PreviewRequest, TemplateRequest } from '../../dtos/requests/bulk-send.request'
import type { BulkSend, BulkTemplate, Preview, Recipient } from '../../dtos/responses/bulk-send.response'

export default interface IBulkSendService {
  templates(): BulkTemplate[]
  createTemplate(r: TemplateRequest): { id: number }
  updateTemplate(id: number, r: TemplateRequest): void
  removeTemplate(id: number): void

  list(accountId: string): BulkSend[]
  recipients(accountId: string, id: number): Recipient[]
  preview(accountId: string, r: PreviewRequest): Preview
  // fills every text in, stores the run and starts it; returns at once
  create(accountId: string, r: CreateBulkSendRequest): { id: number }
  pause(accountId: string, id: number): void
  resume(accountId: string, id: number): void
  cancel(accountId: string, id: number): void
}
