import { z } from 'zod'

// Zalo PC's form: keyword of letters and digits only (max_keyword_length 20), text up to max_msg_content_size 2800
// UTF-8 bytes with line breaks as \n
export const QuickMessageRequest = z.object({
  keyword: z.string().regex(/^[A-Za-z0-9]{1,20}$/, 'Phím tắt chỉ gồm chữ cái và chữ số.'),
  title: z
    .string()
    .transform((s) => s.replace(/\r\n/g, '\n').trim())
    .refine((s) => Buffer.byteLength(s) <= 2800, 'Bạn đã nhập quá số kí tự cho phép'),
})
export type QuickMessageRequest = z.infer<typeof QuickMessageRequest>
