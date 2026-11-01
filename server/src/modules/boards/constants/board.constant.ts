import { GroupEventType } from '@hwqnq/zca-js'

// PC's src for things made from the chat bar; topic color/emoji of a note
export const CHAT_BAR = 1
export const NOTE_COLOR = -16777216
export const REMINDER_EMOJI = '⏰'
// ponytail: first page of 20, as PC's first load; page with last_id/last_type if boards get long
export const PAGE = { page: 1, count: 20 }
// group events that change the board (notes, polls on it, reminders and their RSVPs)
export const BOARD_EVENTS = new Set<GroupEventType>([
  GroupEventType.UPDATE_BOARD,
  GroupEventType.REMOVE_BOARD,
  GroupEventType.UPDATE_TOPIC,
  GroupEventType.REMOVE_TOPIC,
  GroupEventType.ACCEPT_REMIND,
  GroupEventType.REJECT_REMIND,
  GroupEventType.REMIND_TOPIC,
])

// Zalo's codes for these calls, as PC words them
export const ERRORS: Record<number, string> = { 166: 'Bạn không có quyền thực hiện thao tác này', 161: 'Nhóm không tồn tại' }
