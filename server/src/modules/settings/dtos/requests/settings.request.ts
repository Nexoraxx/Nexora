import { z } from 'zod'

// Zalo PC "Quyền riêng tư" (and the "Tin nhắn nhanh" switch): each key with the values its control can send
export const SETTINGS: Record<string, number[]> = {
  view_birthday: [0, 1, 2],
  show_online_status: [0, 1],
  display_seen_status: [0, 1],
  receive_message: [1, 2],
  accept_stranger_call: [2, 3, 4],
  add_friend_via_phone: [0, 1],
  add_friend_via_qr: [0, 1],
  add_friend_via_group: [0, 1],
  add_friend_via_contact: [0, 1],
  display_on_recommend_friend: [0, 1],
  quick_message_status: [0, 1],
}

export const UpdateSettingRequest = z
  .object({ key: z.string(), value: z.number().int() })
  .refine((r) => SETTINGS[r.key]?.includes(r.value), 'Cài đặt không hợp lệ')
export type UpdateSettingRequest = z.infer<typeof UpdateSettingRequest>

// the window is in front with this account open (PC's foreground) or not
export const PresenceRequest = z.object({ foreground: z.boolean() })
