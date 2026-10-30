import { Hono } from 'hono'
import type IAutoReplyService from './services/interfaces/auto-reply-service'
import { AutoReplyEnableRequest, AutoReplyRequest } from './dtos/requests/auto-reply.request'

// Mounted under /accounts/:accountId. Changes from any device go out on /events as "auto_replies".
export const autoReplyRoutes = (replies: IAutoReplyService) =>
  new Hono()
    .get('/auto-replies', async (c) => c.json(await replies.list(c.req.param('accountId')!)))
    .post('/auto-replies', async (c) => {
      await replies.create(c.req.param('accountId')!, AutoReplyRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .put('/auto-replies/:id', async (c) => {
      await replies.update(c.req.param('accountId')!, Number(c.req.param('id')), AutoReplyRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .put('/auto-replies/:id/enable', async (c) => {
      await replies.setEnabled(c.req.param('accountId')!, Number(c.req.param('id')), AutoReplyEnableRequest.parse(await c.req.json()).enable)
      return c.body(null, 204)
    })
    .delete('/auto-replies/:id', async (c) => {
      await replies.remove(c.req.param('accountId')!, Number(c.req.param('id')))
      return c.body(null, 204)
    })
