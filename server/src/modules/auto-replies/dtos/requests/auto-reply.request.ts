import { z } from 'zod'

// Zalo PC's editor: content up to max_content_len 2000; the window as times of day (ms after midnight);
// scope 0 everyone, 1 strangers, 2 only these friends (at least one), 3 friends except these; max_custom_fr 50
export const AutoReplyRequest = z
  .object({
    content: z.string().trim().min(1, 'Nội dung không được để trống.').max(2000, 'Bạn đã nhập quá số kí tự cho phép'),
    start: z.number().int().min(0).max(86_400_000),
    end: z.number().int().min(0).max(86_400_000),
    scope: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    uids: z.array(z.string().min(1)).max(50).default([]),
  })
  .refine((r) => r.scope !== 2 || r.uids.length > 0, 'Chọn ít nhất một người bạn')
  .transform((r) => ({ ...r, uids: r.scope >= 2 ? r.uids : [] }))
export type AutoReplyRequest = z.infer<typeof AutoReplyRequest>

export const AutoReplyEnableRequest = z.object({ enable: z.boolean() })
