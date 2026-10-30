import { z } from 'zod'

export const PinRequest = z.object({ isGroup: z.boolean(), pinned: z.boolean() })
export type PinRequest = z.infer<typeof PinRequest>

// Zalo PC "Tắt thông báo": 1 hour, 4 hours, until 8:00 AM, until turned back on (-1); null turns notifications back on
export const MuteRequest = z.object({ isGroup: z.boolean(), duration: z.union([z.literal(3600), z.literal(14400), z.literal('until8AM'), z.literal(-1), z.null()]) })
export type MuteRequest = z.infer<typeof MuteRequest>

// Zalo PC "Tin nhắn tự xóa": 1 hour, 1 day, 7 days, 14 days (ms); 0 = "Không bao giờ"
export const AutoDeleteRequest = z.object({ isGroup: z.boolean(), ttl: z.union([z.literal(0), z.literal(3_600_000), z.literal(86_400_000), z.literal(604_800_000), z.literal(1_209_600_000)]) })
export type AutoDeleteRequest = z.infer<typeof AutoDeleteRequest>

export const UnreadRequest = z.object({ isGroup: z.boolean(), unread: z.boolean() })
export const ArchivedRequest = z.object({ isGroup: z.boolean(), archived: z.boolean() })
// null takes the conversation out of its label
export const SetLabelRequest = z.object({ isGroup: z.boolean(), labelId: z.number().int().nullable() })

// Zalo PC "Tên phân loại mới (60 ký tự)"
export const LabelRequest = z.object({
  text: z.string().trim().min(1, 'Vui lòng nhập tên phân loại').max(60, 'Tên phân loại tối đa 60 ký tự'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
})
export type LabelRequest = z.infer<typeof LabelRequest>

const Pin = z.string().regex(/^\d{4}$/, 'Mã PIN gồm 4 chữ số')
// the first hide sets the PIN; later hides need it
export const HiddenRequest = z.object({ isGroup: z.boolean(), hidden: z.boolean(), pin: Pin.optional() })
export const PinCheckRequest = z.object({ pin: Pin })
export const ChangePinRequest = z.object({ oldPin: Pin, newPin: Pin })
