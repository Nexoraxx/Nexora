import { z } from 'zod'
import { SETTINGS } from '../../constants/settings.constant'

export const UpdateSettingRequest = z
  .object({ key: z.string(), value: z.number().int() })
  .refine((r) => SETTINGS[r.key]?.includes(r.value), 'Cài đặt không hợp lệ')
export type UpdateSettingRequest = z.infer<typeof UpdateSettingRequest>

// the window is in front with this account open (PC's foreground) or not
export const PresenceRequest = z.object({ foreground: z.boolean() })
