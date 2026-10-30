import { z } from 'zod'

// Zalo PC groupPoll config: question ≤ 200, option ≤ 120, 2–30 options; expiredTime ms, 0 = "Không thời hạn"
export const CreatePollRequest = z.object({
  question: z.string().trim().min(1, 'Vui lòng nhập chủ đề bình chọn').max(200),
  options: z
    .array(z.string().trim().max(120))
    .transform((o) => [...new Set(o.filter(Boolean))])
    .pipe(z.array(z.string()).min(2, 'Bạn không thể tạo bình chọn ít hơn 2 lựa chọn').max(30)),
  expiredTime: z
    .number()
    .int()
    .refine((t) => t === 0 || t > Date.now(), 'Vui lòng chọn thời gian tương lai')
    .default(0),
  pin: z.boolean().default(false),
  allowMultiChoices: z.boolean().default(true),
  allowAddNewOption: z.boolean().default(true),
  hideVotePreview: z.boolean().default(false),
  isAnonymous: z.boolean().default(false),
})
export type CreatePollRequest = z.infer<typeof CreatePollRequest>

// an empty optionIds takes the vote back; newOptions are added and voted for ("Thêm phương án")
export const VoteRequest = z.object({
  optionIds: z.array(z.number().int()),
  newOptions: z.array(z.string().trim().min(1).max(120)).default([]),
})
export type VoteRequest = z.infer<typeof VoteRequest>

// "Tạo ghi chú" / "Sửa ghi chú": PC's "Nội dung" holds up to 3000 characters
export const NoteRequest = z.object({
  title: z.string().trim().min(1, 'Vui lòng nhập nội dung').max(3000, 'Bạn đã nhập quá số kí tự cho phép'),
  pin: z.boolean().default(false),
})
export type NoteRequest = z.infer<typeof NoteRequest>

// "Tạo nhắc hẹn": at least a minute ahead; repeat 0 none, 1 daily, 2 weekly, 3 monthly
export const ReminderRequest = z.object({
  isGroup: z.boolean(),
  title: z.string().trim().min(1, 'Vui lòng nhập nội dung').max(3000, 'Bạn đã nhập quá số kí tự cho phép'),
  startTime: z
    .number()
    .int()
    .refine((t) => t >= Date.now() + 60_000, 'Vui lòng chọn thời gian nhắc hẹn sau thời điểm hiện tại ít nhất 1 phút.'),
  repeat: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
})
export type ReminderRequest = z.infer<typeof ReminderRequest>

export const ThreadKindRequest = z.object({ isGroup: z.stringbool() })

// "Tham gia" / "Từ chối" a group reminder
export const RespondRequest = z.object({ accept: z.boolean() })
