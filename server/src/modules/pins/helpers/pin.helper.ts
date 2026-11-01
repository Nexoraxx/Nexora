import type { Pin } from '../dtos/responses/pin.response'
import type { Topic } from '../models/pin.model'

export const json = (v: unknown) => {
  try {
    return (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>
  } catch {
    return {}
  }
}
export const str = (v: unknown) => (v == null || v === '' ? null : String(v))

// params is a JSON string whose `extra` may itself be JSON (PC parses both)
export function toPin(t: Topic): Pin {
  const p = json(t.params)
  return {
    topicId: String(t.id),
    topicType: Number(t.type),
    msgId: str(p.global_msg_id),
    cliMsgId: str(p.client_msg_id),
    senderUid: str(p.senderUid),
    senderName: str(p.senderName),
    title: String(p.title ?? ''),
    msgType: p.msg_type == null ? null : Number(p.msg_type),
    thumb: str(p.thumb),
    createTime: t.createTime ?? null,
  }
}
