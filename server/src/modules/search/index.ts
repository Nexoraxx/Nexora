import { Hono } from 'hono'
import type ISearchService from './services/interfaces/search-service'
import type IConversationService from '../conversations/services/interfaces/conversation-service'
import { RecentRequest, SearchRequest } from './dtos/requests/search.request'

// Mounted under /accounts/:accountId.
export const searchRoutes = (search: ISearchService, conversations: IConversationService) =>
  new Hono()
    .get('/search', (c) => {
      const accountId = c.req.param('accountId')!
      const { q } = SearchRequest.parse(c.req.query())
      return c.json(search.search(accountId, q, conversations.hidden(accountId), conversations.pinMatches(accountId, q)))
    })
    .get('/recent-search', async (c) => c.json(await search.recent(c.req.param('accountId')!, conversations.hidden(c.req.param('accountId')!))))
    .post('/recent-search', async (c) => {
      await search.addRecent(c.req.param('accountId')!, RecentRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .delete('/recent-search', async (c) => {
      await search.removeRecent(c.req.param('accountId')!, RecentRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
