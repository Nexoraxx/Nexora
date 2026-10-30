import { Hono } from 'hono'
import type IStickerService from './services/interfaces/sticker-service'
import { StickerCategoryParam, StickerSearchRequest, StickerSuggestRequest } from './dtos/requests/sticker.request'

// Mounted under /accounts/:accountId. Sending stays at POST /threads/:threadId/stickers.
export const stickerRoutes = (stickers: IStickerService) =>
  new Hono()
    .get('/stickers/categories', async (c) => c.json(await stickers.categories(c.req.param('accountId')!)))
    .get('/stickers/categories/:cateId', async (c) => c.json(await stickers.stickers(c.req.param('accountId')!, StickerCategoryParam.parse(c.req.param('cateId')))))
    .put('/stickers/categories/:cateId', async (c) => {
      await stickers.setAdded(c.req.param('accountId')!, StickerCategoryParam.parse(c.req.param('cateId')), true)
      return c.body(null, 204)
    })
    .delete('/stickers/categories/:cateId', async (c) => {
      await stickers.setAdded(c.req.param('accountId')!, StickerCategoryParam.parse(c.req.param('cateId')), false)
      return c.body(null, 204)
    })
    .get('/stickers/store', async (c) => c.json(await stickers.store(c.req.param('accountId')!)))
    .get('/stickers/recent', (c) => c.json(stickers.recent(c.req.param('accountId')!)))
    .get('/stickers/search', async (c) => {
      const { q } = StickerSearchRequest.parse(c.req.query())
      return c.json(await stickers.search(c.req.param('accountId')!, q))
    })
    .get('/stickers/suggest/keywords', async (c) => c.json(await stickers.suggestKeywords(c.req.param('accountId')!)))
    .get('/stickers/suggest', async (c) => {
      const { keyword } = StickerSuggestRequest.parse(c.req.query())
      return c.json(await stickers.suggest(c.req.param('accountId')!, keyword))
    })
