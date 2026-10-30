import { createDecipheriv } from 'node:crypto'
import JSONBig from 'json-bigint'
import { ZaloApiError, type API } from '@hwqnq/zca-js'

const POST_API = 'nexoraPost'
type PostProps = { url: string; params: Record<string, unknown>; inQuery: boolean }

// POST to a Zalo endpoint zca has no call for (or none matching PC), params AES-encrypted as PC sends them: in the
// body, or on the query string with an empty body (inQuery)
export function zaloPost<T = unknown>(api: API, service: keyof API['zpwServiceMap'], path: string, params: Record<string, unknown>, inQuery = false): Promise<T> {
  if (!(POST_API in api))
    api.custom<unknown, PostProps>(POST_API, async ({ utils, props }) => {
      const encrypted = utils.encodeAES(JSON.stringify(props.params))
      if (!encrypted) throw new Error('Failed to encrypt params')
      const url = props.inQuery ? utils.makeURL(props.url, { params: encrypted }) : utils.makeURL(props.url)
      return utils.resolve(await utils.request(url, props.inQuery ? { method: 'POST' } : { method: 'POST', body: new URLSearchParams({ params: encrypted }) }))
    })
  const base = (api.zpwServiceMap[service] as string[] | undefined)?.[0]
  if (!base) throw new Error(`Zalo service ${service} unavailable`)
  return (api as unknown as Record<string, (p: PostProps) => Promise<T>>)[POST_API]({ url: `${base}${path}`, params, inQuery })
}

// each request gets its own clientId, as on PC
let lastClientId = 0
export const nextClientId = () => String((lastClientId = Math.max(lastClientId + 1, Date.now())))

const GET_API = 'nexoraGet'
type GetProps = { url: string; params: Record<string, unknown> }
const bigJson = JSONBig({ storeAsString: true })

// zca decodes responses with JSON.parse, which corrupts 19-digit ids sent as numbers (unread marks, archived chats,
// labels): this GET decrypts the reply itself (AES-CBC, zero iv, as zca's decodeAES) and keeps big numbers as strings
export function zaloGet<T = unknown>(api: API, service: keyof API['zpwServiceMap'], path: string, params: Record<string, unknown>): Promise<T> {
  if (!(GET_API in api))
    api.custom<unknown, GetProps>(GET_API, async ({ ctx, utils, props }) => {
      const encrypted = utils.encodeAES(JSON.stringify(props.params))
      if (!encrypted) throw new Error('Failed to encrypt params')
      const res = await utils.request(utils.makeURL(props.url, { params: encrypted }), { method: 'GET' })
      if (!res.ok) throw new ZaloApiError(`Request failed with status code ${res.status}`)
      return decodeReply(await res.text(), ctx.secretKey!)
    })
  const base = (api.zpwServiceMap[service] as string[] | undefined)?.[0]
  if (!base) throw new Error(`Zalo service ${service} unavailable`)
  return (api as unknown as Record<string, (p: GetProps) => Promise<T>>)[GET_API]({ url: `${base}${path}`, params })
}

// { error_code, error_message, data: AES(JSON { error_code, error_message, data }) }
export function decodeReply(text: string, secretKey: string) {
  const outer = bigJson.parse(text) as { error_code: number; error_message?: string; data: string }
  if (outer.error_code != 0) throw new ZaloApiError(outer.error_message ?? 'Lỗi không xác định', Number(outer.error_code))
  const key = Buffer.from(secretKey, 'base64')
  const decipher = createDecipheriv(`aes-${key.length * 8}-cbc`, key, Buffer.alloc(16))
  const plain = Buffer.concat([decipher.update(Buffer.from(decodeURIComponent(outer.data), 'base64')), decipher.final()]).toString('utf8')
  const inner = bigJson.parse(plain) as { error_code: number; error_message?: string; data: unknown }
  if (inner.error_code != 0) throw new ZaloApiError(inner.error_message ?? 'Lỗi không xác định', Number(inner.error_code))
  return inner.data
}

// nested JSON strings (unread marks, label lists) with big numbers kept as strings
export const parseBig = <T>(v: unknown): T => (typeof v === 'string' ? bigJson.parse(v) : v) as T
