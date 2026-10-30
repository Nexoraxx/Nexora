// a pinned topic as the pin bar shows it; msgId set when it pins a message
export type Pin = {
  topicId: string
  topicType: number
  msgId: string | null
  cliMsgId: string | null
  senderUid: string | null
  senderName: string | null
  title: string
  msgType: number | null
  thumb: string | null
  createTime: number | null
}
