// PC's MAX_TODO_CONTENT; TODO_DATE_TYPE NO_DATE / custom; CREATE_TODO_SRC MSG_MENU / CHATBAR_ICON; MSG_TEXT
export const MAX_CONTENT = 2000
export const NO_DATE = 0
export const CUSTOM_DATE = 5
export const FROM_MESSAGE = 2
export const FROM_CHATBAR = 5
export const MSG_TEXT = 1
export const TODO_MESSAGE = 'chat.todo'
// zca's message types as PC's numeric ones (zca's getClientMessageType, not exported)
export const CLIENT_TYPE: Record<string, number> = {
  webchat: 1,
  'chat.voice': 31,
  'chat.photo': 32,
  'chat.sticker': 36,
  'chat.doodle': 37,
  'chat.recommended': 38,
  'chat.link': 38,
  'chat.location.new': 43,
  'chat.video.msg': 44,
  'share.file': 46,
  'chat.gif': 49,
}
// verify pages until updated and deleted both come back empty; capped so a reply that never ends can't loop forever
export const MAX_PAGES = 50
// zca's send reply has no clientId: the listener echo of our own message (selfListen) stores it
export const ECHO_TRIES = 15
export const ECHO_WAIT = 200

export const NOT_EXIST = 'Công việc đã bị xoá hay không còn khả dụng'
// PC's toasts per Zalo code (STR_TODO_TOAST_*, STR_TODO_NOT_EXIST_TASK)
export const CREATE_ERRORS: Record<number, string> = { 112: 'Có lỗi xảy ra khi tạo công việc', 166: 'Tạo công việc không thành công vì bạn không thể giao việc cho một vài thành viên' }
export const STATUS_ERRORS: Record<number, string> = { 166: 'Bạn không thể thay đổi trạng thái vì công việc đã được giao cho người khác', 212: NOT_EXIST }
export const ERRORS: Record<number, string> = { 212: NOT_EXIST }
export const SEND_FAILED = 'Có lỗi xảy ra khi tạo công việc vì không thể gửi tin nhắn'
