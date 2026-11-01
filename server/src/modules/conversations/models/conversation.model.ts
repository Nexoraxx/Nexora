import { type LabelData } from '@hwqnq/zca-js'

// muted: until (ms) or -1 = until turned back on; ttl: "Tin nhắn tự xóa" (ms); unread: "Đánh dấu chưa đọc";
// archived: in "Khác" instead of "Ưu tiên"; hidden: "Ẩn trò chuyện", pin = md5 of its 4-digit PIN ('' = none set)
export type State = {
  pinned: Set<string>
  muted: Map<string, number>
  ttl: Map<string, number>
  unread: Set<string>
  archived: Set<string>
  labels: LabelData[]
  labelVersion: number
  hidden: Set<string>
  pin: string
}
