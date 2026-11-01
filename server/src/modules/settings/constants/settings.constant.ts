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

// Zalo PC update_action_interval; ping status: 1 foreground, 0 background, 2 / 3 coming to / leaving the foreground
export const PING_EVERY = 60_000
export const FOREGROUND = 1
export const BACKGROUND = 0
export const TO_FOREGROUND = 2
export const TO_BACKGROUND = 3
// PC reads these snake_case but writes them camelCase (as zca's UpdateSettingsType does)
export const WIRE: Record<string, string> = { quick_message_status: 'quickMessageStatus', archived_chat_status: 'archivedChatStatus' }
