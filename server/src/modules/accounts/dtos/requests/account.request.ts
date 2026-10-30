import { z } from 'zod'
import { AccountState } from '../responses/account.response'

export const UpdateAccountStateRequest = z.object({ state: AccountState })
export type UpdateAccountStateRequest = z.infer<typeof UpdateAccountStateRequest>

// Zalo PC's "Cập nhật thông tin cá nhân": the name is checked by Zalo (error 18035), only emptiness here; birth years
// run from 1903 to (this year - min_age_limit 14), Zalo rejects others with 18075.
export const UpdateProfileRequest = z.object({
  name: z.string().refine((s) => s.trim().length > 0, 'Vui lòng nhập tên'),
  gender: z.union([z.literal(0), z.literal(1)]),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày sinh không hợp lệ')
    .refine((s) => Number(s.slice(0, 4)) >= 1903 && Number(s.slice(0, 4)) <= new Date().getFullYear() - 14, 'Ngày sinh không hợp lệ'),
})
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>

// multipart: the square JPEG already cropped by the client, with its pixel size
export const ChangeAvatarRequest = z.object({
  file: z.instanceof(File),
  width: z.coerce.number().int().positive(),
  height: z.coerce.number().int().positive(),
})
export type ChangeAvatarRequest = z.infer<typeof ChangeAvatarRequest>

export const ReuseAvatarRequest = z.object({ photoId: z.string().min(1) })

// "Bio": PC v26.10.20 only shows it; set the way Zalo's mobile app does (/api/social/profile/status)
export const UpdateBioRequest = z.object({ status: z.string().trim() })
