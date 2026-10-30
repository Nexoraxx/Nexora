import { Hono } from 'hono'
import type IContactService from './services/interfaces/contact-service'
import { FindUserRequest, RenameGroupRequest, ReportRequest, SendFriendRequestRequest, UpdateAliasRequest } from './dtos/requests/contact.request'

// Mounted under /accounts/:accountId
export const contactRoutes = (contacts: IContactService) =>
  new Hono()
    .get('/friends', (c) => c.json(contacts.friends(c.req.param('accountId')!)))
    .get('/friends/online', async (c) => c.json(await contacts.onlineFriends(c.req.param('accountId')!)))
    .get('/groups', (c) => c.json(contacts.groups(c.req.param('accountId')!)))
    .get('/groups/:groupId', async (c) => c.json(await contacts.group(c.req.param('accountId')!, c.req.param('groupId'))))
    .put('/groups/:groupId/name', async (c) => {
      const { name } = RenameGroupRequest.parse(await c.req.json())
      await contacts.renameGroup(c.req.param('accountId')!, c.req.param('groupId'), name)
      return c.body(null, 204)
    })
    .get('/friend-requests', (c) => c.json(contacts.requests(c.req.param('accountId')!)))
    .get('/friend-requests/sent', async (c) => c.json(await contacts.sentRequests(c.req.param('accountId')!)))
    .post('/friend-requests', async (c) => {
      const { userId, message } = SendFriendRequestRequest.parse(await c.req.json())
      await contacts.sendRequest(c.req.param('accountId')!, userId, message)
      return c.body(null, 204)
    })
    .delete('/friend-requests/sent/:userId', async (c) => {
      await contacts.undoRequest(c.req.param('accountId')!, c.req.param('userId'))
      return c.body(null, 204)
    })
    .post('/friend-requests/seen', async (c) => {
      await contacts.seenRequests(c.req.param('accountId')!)
      return c.body(null, 204)
    })
    .post('/friend-requests/:userId/accept', async (c) => {
      await contacts.accept(c.req.param('accountId')!, c.req.param('userId'))
      return c.body(null, 204)
    })
    .post('/friend-requests/:userId/reject', async (c) => {
      await contacts.reject(c.req.param('accountId')!, c.req.param('userId'))
      return c.body(null, 204)
    })
    .delete('/friends/:userId', async (c) => {
      await contacts.removeFriend(c.req.param('accountId')!, c.req.param('userId'))
      return c.body(null, 204)
    })
    .put('/friends/:userId/alias', async (c) => {
      const { alias } = UpdateAliasRequest.parse(await c.req.json())
      await contacts.setAlias(c.req.param('accountId')!, c.req.param('userId'), alias)
      return c.body(null, 204)
    })
    .get('/blocks', async (c) => c.json(await contacts.blockList(c.req.param('accountId')!)))
    .put('/blocks/:userId', async (c) => {
      await contacts.setBlocked(c.req.param('accountId')!, c.req.param('userId'), true)
      return c.body(null, 204)
    })
    .delete('/blocks/:userId', async (c) => {
      await contacts.setBlocked(c.req.param('accountId')!, c.req.param('userId'), false)
      return c.body(null, 204)
    })
    .get('/cloud', (c) => c.json(contacts.cloud(c.req.param('accountId')!)))
    .get('/users/find', async (c) => {
      return c.json(await contacts.findUser(c.req.param('accountId')!, FindUserRequest.parse(c.req.query())))
    })
    .post('/users/:userId/report', async (c) => {
      const { reason, content } = ReportRequest.parse(await c.req.json())
      await contacts.report(c.req.param('accountId')!, c.req.param('userId'), false, reason, content)
      return c.body(null, 204)
    })
    .post('/groups/:groupId/report', async (c) => {
      const { reason, content } = ReportRequest.parse(await c.req.json())
      await contacts.report(c.req.param('accountId')!, c.req.param('groupId'), true, reason, content)
      return c.body(null, 204)
    })
    .get('/users/:userId/last-online', async (c) => c.json({ lastOnline: await contacts.lastOnline(c.req.param('accountId')!, c.req.param('userId')) }))
    .get('/users/:userId', async (c) => c.json(await contacts.profile(c.req.param('accountId')!, c.req.param('userId'))))
    .post('/contacts/sync', async (c) => {
      await contacts.sync(c.req.param('accountId')!)
      return c.body(null, 204)
    })
