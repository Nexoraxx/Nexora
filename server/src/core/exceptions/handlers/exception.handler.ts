import type { ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { ZaloApiError } from '@hwqnq/zca-js'

export const exceptionHandler: ErrorHandler = (e, c) => {
  if (e instanceof HTTPException) return c.json({ error: e.message }, e.status)
  if (e instanceof ZodError) return c.json({ error: e.issues.map((i) => i.message).join(', ') }, 400)
  if (e instanceof ZaloApiError) return c.json({ error: e.message, code: e.code }, 502)
  console.error(e)
  return c.json({ error: 'Internal error' }, 500)
}
