import { z } from 'zod'

export const SearchRequest = z.object({ q: z.string().trim().min(1).max(100, 'Vui lòng nhập ít hơn 100 ký tự') })

// a "Tìm gần đây" entry: a contact / group opened from the results, or a keyword
export const RecentRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('contact'), id: z.string().min(1), isGroup: z.boolean() }),
  z.object({ kind: z.literal('keyword'), key: z.string().trim().min(1).max(100) }),
])
export type RecentRequest = z.infer<typeof RecentRequest>
