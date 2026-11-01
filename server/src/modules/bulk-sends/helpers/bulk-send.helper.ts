import { HTTPException } from 'hono/http-exception'
import { ZaloApiError } from '@hwqnq/zca-js'

// Zalo answered with an error code, or Nexora refused before calling Zalo: surely not delivered. Anything else
// (network, timeout, sendText's 502 wrapping one) may have gone out, so it's 'unknown' and never retried
export const notSent = (e: unknown) => (e instanceof ZaloApiError && e.code != null) || (e instanceof HTTPException && e.status !== 502)
export const describe = (e: unknown) => {
  if (!(e instanceof Error)) return String(e)
  const text = e.message && e.message !== 'null' && e.message !== 'undefined' ? e.message : 'Lỗi không xác định'
  return e instanceof ZaloApiError && e.code != null ? `${text} (mã ${e.code})` : text
}
