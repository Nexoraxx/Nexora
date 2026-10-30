import { Hono } from 'hono'
import type IPinService from './services/interfaces/pin-service'
import { PinRequest, UnpinRequest } from './dtos/requests/pin.request'

// Mounted under /accounts/:accountId. Changes from anyone go out on /events as "pins".
export const pinRoutes = (pins: IPinService) =>
  new Hono()
    .get('/threads/:threadId/pins', async (c) => c.json(await pins.list(c.req.param('accountId')!, c.req.param('threadId'))))
    .post('/threads/:threadId/pins', async (c) => {
      await pins.pin(c.req.param('accountId')!, c.req.param('threadId'), PinRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .delete('/threads/:threadId/pins', async (c) => {
      const { topicId, topicType } = UnpinRequest.parse(await c.req.json())
      await pins.unpin(c.req.param('accountId')!, c.req.param('threadId'), topicId, topicType)
      return c.body(null, 204)
    })
