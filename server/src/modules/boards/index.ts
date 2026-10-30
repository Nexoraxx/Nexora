import { Hono } from 'hono'
import type IBoardService from './services/interfaces/board-service'
import { CreatePollRequest, NoteRequest, ReminderRequest, RespondRequest, ThreadKindRequest, VoteRequest } from './dtos/requests/board.request'

// Mounted under /accounts/:accountId. Board changes from anyone go out on /events as "board".
export const boardRoutes = (boards: IBoardService) =>
  new Hono()
    .get('/groups/:groupId/board', async (c) => c.json(await boards.board(c.req.param('accountId')!, c.req.param('groupId'))))
    .post('/groups/:groupId/polls', async (c) => c.json(await boards.createPoll(c.req.param('accountId')!, c.req.param('groupId'), CreatePollRequest.parse(await c.req.json()))))
    .get('/groups/:groupId/polls/:pollId', async (c) => c.json(await boards.poll(c.req.param('accountId')!, c.req.param('groupId'), c.req.param('pollId'))))
    .post('/groups/:groupId/polls/:pollId/votes', async (c) =>
      c.json(await boards.vote(c.req.param('accountId')!, c.req.param('groupId'), c.req.param('pollId'), VoteRequest.parse(await c.req.json()))),
    )
    .post('/groups/:groupId/polls/:pollId/lock', async (c) => {
      await boards.lockPoll(c.req.param('accountId')!, c.req.param('groupId'), c.req.param('pollId'))
      return c.body(null, 204)
    })
    .post('/groups/:groupId/notes', async (c) => {
      await boards.createNote(c.req.param('accountId')!, c.req.param('groupId'), NoteRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .put('/groups/:groupId/notes/:topicId', async (c) => {
      await boards.editNote(c.req.param('accountId')!, c.req.param('groupId'), c.req.param('topicId'), NoteRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .delete('/groups/:groupId/notes/:topicId', async (c) => {
      await boards.removeTopic(c.req.param('accountId')!, c.req.param('groupId'), c.req.param('topicId'), true)
      return c.body(null, 204)
    })
    .get('/threads/:threadId/reminders', async (c) =>
      c.json(await boards.reminders(c.req.param('accountId')!, c.req.param('threadId'), ThreadKindRequest.parse(c.req.query()).isGroup)),
    )
    .post('/threads/:threadId/reminders', async (c) => {
      await boards.createReminder(c.req.param('accountId')!, c.req.param('threadId'), ReminderRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .put('/threads/:threadId/reminders/:reminderId', async (c) => {
      await boards.editReminder(c.req.param('accountId')!, c.req.param('threadId'), c.req.param('reminderId'), ReminderRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .delete('/threads/:threadId/reminders/:reminderId', async (c) => {
      const { isGroup } = ThreadKindRequest.parse(c.req.query())
      await boards.removeTopic(c.req.param('accountId')!, c.req.param('threadId'), c.req.param('reminderId'), isGroup)
      return c.body(null, 204)
    })
    .post('/groups/:groupId/reminders/:reminderId/response', async (c) => {
      await boards.respond(c.req.param('accountId')!, c.req.param('groupId'), c.req.param('reminderId'), RespondRequest.parse(await c.req.json()).accept)
      return c.body(null, 204)
    })
