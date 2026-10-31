import { z } from 'zod'
import { unknownVariables } from '../../services/implements/template'

// as Zalo PC's message box: up to 2800 UTF-8 bytes, line breaks as \n. Unknown {{keys}} are refused so a customer
// never reads "{{nmae}}"
const Body = z
  .string()
  .transform((s) => s.replace(/\r\n/g, '\n').trim())
  .refine((s) => s.length > 0, 'Nhập nội dung tin nhắn')
  .refine((s) => Buffer.byteLength(s) <= 2800, 'Bạn đã nhập quá số kí tự cho phép')
  .superRefine((s, ctx) => {
    const bad = unknownVariables(s)
    if (bad.length) ctx.addIssue({ code: 'custom', message: `Không có biến ${bad.map((k) => `{{${k}}}`).join(', ')}` })
  })

export const TemplateRequest = z.object({ name: z.string().trim().min(1, 'Nhập tên mẫu').max(60), body: Body })
export type TemplateRequest = z.infer<typeof TemplateRequest>

export const PreviewRequest = z.object({ body: Body, userIds: z.array(z.string()).min(1, 'Chọn ít nhất một người nhận') })
export type PreviewRequest = z.infer<typeof PreviewRequest>
// name: the template's, shown in the list of runs
export const CreateBulkSendRequest = PreviewRequest.extend({ name: z.string().trim().min(1).max(60) })
export type CreateBulkSendRequest = z.infer<typeof CreateBulkSendRequest>
