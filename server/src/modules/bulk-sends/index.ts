import { Hono } from 'hono'
import type IBulkSendService from './services/interfaces/bulk-send-service'
import { CreateBulkSendRequest, PreviewRequest, TemplateRequest } from './dtos/requests/bulk-send.request'

// "Gửi hàng loạt". Templates are shared by every account: mounted at the root
export const bulkTemplateRoutes = (bulk: IBulkSendService) =>
  new Hono()
    .get('/bulk-templates', (c) => c.json(bulk.templates()))
    .post('/bulk-templates', async (c) => c.json(bulk.createTemplate(TemplateRequest.parse(await c.req.json()))))
    .put('/bulk-templates/:id', async (c) => {
      bulk.updateTemplate(Number(c.req.param('id')), TemplateRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .delete('/bulk-templates/:id', (c) => {
      bulk.removeTemplate(Number(c.req.param('id')))
      return c.body(null, 204)
    })

// Runs: mounted under /accounts/:accountId. Progress goes out on /events as "bulk_sends".
export const bulkSendRoutes = (bulk: IBulkSendService) =>
  new Hono()
    .get('/bulk-sends', (c) => c.json(bulk.list(c.req.param('accountId')!)))
    .get('/bulk-sends/:id/recipients', (c) => c.json(bulk.recipients(c.req.param('accountId')!, Number(c.req.param('id')))))
    .post('/bulk-sends/preview', async (c) => c.json(bulk.preview(c.req.param('accountId')!, PreviewRequest.parse(await c.req.json()))))
    .post('/bulk-sends', async (c) => c.json(bulk.create(c.req.param('accountId')!, CreateBulkSendRequest.parse(await c.req.json()))))
    .post('/bulk-sends/:id/:action{pause|resume|cancel}', (c) => {
      bulk[c.req.param('action') as 'pause' | 'resume' | 'cancel'](c.req.param('accountId')!, Number(c.req.param('id')))
      return c.body(null, 204)
    })
