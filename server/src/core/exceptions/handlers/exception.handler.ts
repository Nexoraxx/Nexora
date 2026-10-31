import type { ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { ZaloApiError } from '@hwqnq/zca-js'

export const exceptionHandler: ErrorHandler = (e, c) => {
  if (e instanceof HTTPException) return c.json({ error: e.message }, e.status)
  if (e instanceof ZodError) return c.json({ error: e.issues.map((i) => i.message).join(', ') }, 400)
  if (e instanceof ZaloApiError) {
    console.error(`[zalo] ${c.req.method} ${c.req.path}: ${e.code} ${e.message}`)
    // zca builds the error from Zalo's error_message, which can be missing: Error(null) reads "null"
    const message = e.message && e.message !== 'null' && e.message !== 'undefined' ? e.message : `Lỗi không xác định (mã ${e.code})`
    return c.json({ error: message, code: e.code }, 502)
  }
  console.error(e)
  return c.json({ error: 'Internal error' }, 500)
}
