import { Hono } from 'hono'
import { z } from 'zod'
import type { ZcallService } from '../../third-party/zcall/zcall-service'

const CallRequest = z.object({ userId: z.string().min(1), name: z.string().default(''), avatar: z.string().nullish(), video: z.boolean().default(false) })

// Mounted under /accounts/:accountId. The call engine opens its own window; nothing else comes back.
export const callRoutes = (calls: ZcallService) =>
  new Hono()
    .post('/calls', async (c) => {
      const { userId, name, avatar, video } = CallRequest.parse(await c.req.json())
      calls.makeCall(c.req.param('accountId')!, { id: userId, name, avatar: avatar ?? '' }, video)
      return c.body(null, 204)
    })
