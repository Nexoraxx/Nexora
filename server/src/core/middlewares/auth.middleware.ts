import { createMiddleware } from 'hono/factory'
import { config } from '../../config'

// Browsers can't set headers on a WebSocket, so the token may also come as ?token=
export const authMiddleware = createMiddleware(async (c, next) => {
  const token = c.req.header('authorization')?.replace(/^Bearer /, '') ?? c.req.query('token')
  if (token !== config.token) return c.json({ error: 'Unauthorized' }, 401)
  await next()
})
