import { Hono } from 'hono'
import type IQuickMessageService from './services/interfaces/quick-message-service'
import { QuickMessageRequest } from './dtos/requests/quick-message.request'

// Mounted under /accounts/:accountId. Changes from any device go out on /events as "quick_messages".
export const quickMessageRoutes = (quick: IQuickMessageService) =>
  new Hono()
    .get('/quick-messages', async (c) => c.json(await quick.list(c.req.param('accountId')!)))
    .post('/quick-messages', async (c) => {
      await quick.create(c.req.param('accountId')!, QuickMessageRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .put('/quick-messages/:id', async (c) => {
      await quick.update(c.req.param('accountId')!, c.req.param('id'), QuickMessageRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .delete('/quick-messages/:id', async (c) => {
      await quick.remove(c.req.param('accountId')!, c.req.param('id'))
      return c.body(null, 204)
    })
