import { stripE2eeParams } from '../../../third-party/signal/e2ee-content'
import { MIME, E2EE, E2EE_CMDS } from '../constants/message.constant'
import { ThreadType, type Message } from '@hwqnq/zca-js'
import type { Row } from '../models/message.model'
import { E2EE_STATUS, type Decrypted } from '../../../third-party/signal/e2ee-message-receiver'

export const list = <T>(v: T | T[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v])
export const mimeOf = (url: string) => MIME[(stripE2eeParams(url).split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()] ?? 'application/octet-stream'

// search text: a text body, a file name, a link title
export const textOf = (content: unknown) => (typeof content === 'string' ? content : ((content as { title?: string })?.title ?? null))

// E2EE messages (cmd 551) are stored decrypted; one Nexora can't read stays chat.e2ee, out of search, with its
// decryption state in e2eeStatus
export const toRow = (accountId: string, { data, threadId }: Message, dec?: Decrypted): Row => {
  const e2ee = E2EE_CMDS.includes(Number(data.cmd))
  const read = e2ee && dec?.status === E2EE_STATUS.OK
  const content = read ? dec.content : data.content
  return {
    accountId,
    msgId: String(data.msgId),
    cliMsgId: String(data.cliMsgId),
    toUid: threadId,
    fromUid: data.uidFrom,
    dName: data.dName,
    msgType: e2ee && !read ? E2EE : data.msgType,
    // a missing ts must not fail the NOT NULL column and drop the whole batch
    sendDttm: Number(data.ts) || Date.now(),
    message: JSON.stringify(content),
    msgText: e2ee && !read ? null : textOf(content),
    quote: read && dec.quote ? dec.quote : data.quote,
    mentions: 'mentions' in data ? data.mentions : undefined,
    ttl: data.ttl,
    status: data.status,
    notify: data.notify,
    st: data.st,
    at: data.at,
    cmd: data.cmd,
    properties: data.propertyExt,
    paramsExt: data.paramsExt,
    topOut: data.topOut,
    topOutTimeOut: data.topOutTimeOut,
    topOutImprTimeOut: data.topOutImprTimeOut,
    ...(e2ee && { e2eeStatus: dec?.status ?? null }),
  }
}

export const parse = (json: string | null) => (json == null ? null : JSON.parse(json))
export const parseParams = (c: { params?: unknown }) => {
  try {
    return (typeof c.params === 'string' ? JSON.parse(c.params) : (c.params ?? {})) as Record<string, unknown>
  } catch {
    return {}
  }
}
// "5 phút", "1 giờ", "1 ngày" for PC's recall limit message
export const duration = (seconds: number) => (seconds % 86400 === 0 ? `${seconds / 86400} ngày` : seconds % 3600 === 0 ? `${seconds / 3600} giờ` : `${Math.round(seconds / 60)} phút`)
// PC's getPhoneNumberPro: Vietnamese numbers as 0xxx, others as +country
export const phone = (n: string | null | undefined) => (!n ? undefined : n.startsWith('84') ? `0${n.slice(2)}` : n.startsWith('0') || n.startsWith('+') ? n : `+${n}`)
// receiver fields of PC's /forward, /gif, ... requests
export const receiver = (threadId: string, type: ThreadType, userKey = 'toId') => (type === ThreadType.Group ? { grid: threadId, visibility: 0 } : { [userKey]: threadId })
export const newer = (a: string, b: string) => BigInt(a) > BigInt(b)
export const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))
