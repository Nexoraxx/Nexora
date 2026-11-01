import { GroupEventType } from '@hwqnq/zca-js'

// content-type for a decrypted E2EE blob, from the href path extension (the CDN's type is for the encrypted bytes)
export const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', m4a: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', amr: 'audio/amr' }

// Zalo PC turns a recalled message into this type
export const UNDONE = 'chat.undo'

// Zalo PC's SignalCommands.MSG RECEIVE_ONEONE / RECEIVE_GROUP: end-to-end encrypted (Signal) messages, which zca
// passes on as ciphertext. Decrypted ones are stored as their real type with e2eeStatus E2EE_READ; the rest stay
// chat.e2ee, out of search.
export const E2EE_CMDS = [551, 552]
export const E2EE = 'chat.e2ee'
// Zalo PC's MSG_E2EE: decrypted
export const E2EE_READ = 3000

// events that may take this account out of a group
export const OUT_EVENTS = new Set<GroupEventType>([GroupEventType.LEAVE, GroupEventType.REMOVE_MEMBER, GroupEventType.BLOCK_MEMBER])

// sendDeliveredEvent / sendSeenEvent accept at most 50 messages
export const RECEIPT_BATCH = 50
export const LAST_SEEN_BATCH = 50
// Zalo PC doesn't repeat a group cloud request with the same params within this window (cloud.preventCloudLoadSameParams)
export const CLOUD_SAME_PARAMS_MS = 10_000
// Zalo PC: settings.chat.time_undomsg (seconds) when the server sends it, else 5 minutes; max_msg_per_recall
export const RECALL_SECONDS = 300
export const MAX_RECALL = 50
// Zalo PC's max_member_group_show_seen: bigger groups get no "Đã xem" / "Đã nhận" lists
export const SEEN_MAX_MEMBERS = 20
// a jump to a found message loads everything from it to the newest, up to this many
export const JUMP_LIMIT = 1000
// Zalo PC's msgType codes for /api/message/forward and /api/group/forward (MSGTYPE_FORWARD_*)
export const FORWARD_TYPE: Record<string, number> = { 'share.file': 1, 'chat.photo': 2, 'chat.doodle': 2, 'chat.voice': 3, 'chat.gif': 4, 'chat.video.msg': 5, 'chat.location.new': 7 }
export const FORWARD_CONTACT = 6
// Zalo PC "Gửi danh thiếp": at most 9 cards at once
export const MAX_CARDS = 9
// Zalo PC link preview: max_url_character, title / desc cut at 80 / 200
export const MAX_URL = 500
export const LINK_TITLE = 80
export const LINK_DESC = 200
// Zalo PC GIF panel: first trending page 50, then pages of 10 (search too); src 1 = sent from the chat bar
export const GIF_FIRST_PAGE = 50
export const GIF_PAGE = 10
export const GIF_SRC_CHAT = 1
// ponytail: only text is end-to-end encrypted so far; replies, media, stickers, links, cards, forwards are refused there
export const E2EE_UNSUPPORTED = 'Nexora chưa hỗ trợ gửi loại tin nhắn này trong trò chuyện mã hóa đầu cuối'
// this account's devices in PC's MISS_BUNDLE_KEY_* messages, in PC's order
export const MY_DEVICE_NAMES: [number, string][] = [
  [0, 'Zalo trên điện thoại'],
  [2, 'Zalo PC'],
  [1, 'Zalo trên trình duyệt máy tính'],
]
