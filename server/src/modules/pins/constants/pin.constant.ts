import { GroupEventType } from '@hwqnq/zca-js'

// Zalo PC topic type of a pinned message (0 note, 1 link, 2 message, 3 poll, 4 reminder)
export const MSG_TOPIC = 2
// Zalo PC: 1-1 pins are capped at 3; groups use pin/list's pinLimit, else group_topics.pin_limit 10
export const FRIEND_PIN_LIMIT = 3
export const GROUP_PIN_LIMIT = 10
// createGroupTopicv2's color when settings.group.topic_colors is empty
export const TOPIC_COLOR = -16777216
// Zalo PC's msg_type codes inside a pinned message's params, and its emoji per type (getUnicodeCorrMSGType)
export const CLI_TYPE: Record<string, number> = {
  webchat: 1,
  'chat.voice': 31,
  'chat.photo': 32,
  'chat.sticker': 36,
  'chat.doodle': 37,
  'chat.recommended': 38,
  'chat.location.new': 43,
  'chat.video.msg': 44,
  'share.file': 46,
  'chat.gif': 49,
}
export const EMOJI: Record<string, string> = { webchat: '📌', 'chat.photo': '🌄', 'chat.gif': '🌄', 'chat.doodle': '🌄', 'chat.video.msg': '🎥', 'chat.location.new': '📍' }
export const PIN_EVENTS = new Set([GroupEventType.NEW_PIN_TOPIC, GroupEventType.UPDATE_PIN_TOPIC, GroupEventType.UNPIN_TOPIC, GroupEventType.REORDER_PIN_TOPIC])
