import { z } from 'zod'

export const SendFriendRequestRequest = z.object({ userId: z.string().min(1), message: z.string().default('') })
export type SendFriendRequestRequest = z.infer<typeof SendFriendRequestRequest>

export const UpdateAliasRequest = z.object({ alias: z.string().trim() })
export type UpdateAliasRequest = z.infer<typeof UpdateAliasRequest>

// Zalo PC refuses an empty group name client-side (zca would send Date.now() instead)
export const RenameGroupRequest = z.object({ name: z.string().trim().min(1, 'Vui lòng nhập tên nhóm') })

// "Thêm bạn": by phone, or by Zalo username (PC only looks usernames up from zalo://conversation?username= links)
export const FindUserRequest = z
  .object({ phone: z.string().trim().min(1).optional(), username: z.string().trim().min(1).optional() })
  .refine((r) => r.phone || r.username, 'Vui lòng nhập số điện thoại hoặc username')
export type FindUserRequest = z.infer<typeof FindUserRequest>

// "Báo xấu": 1 Nội dung nhạy cảm, 2 Làm phiền, 3 Lừa đảo, 0 Vấn đề khác (description required, at most 1000 chars)
export const ReportRequest = z
  .object({ reason: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]), content: z.string().trim().max(1000).default('') })
  .refine((r) => r.reason !== 0 || r.content, 'Nhập mô tả để tiếp tục')
export type ReportRequest = z.infer<typeof ReportRequest>
