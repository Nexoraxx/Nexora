import { Hono } from 'hono'
import type IConversationService from './services/interfaces/conversation-service'
import type IMessageService from '../messages/services/interfaces/message-service'
import {
  ArchivedRequest,
  AutoDeleteRequest,
  ChangePinRequest,
  HiddenRequest,
  LabelRequest,
  MuteRequest,
  PinCheckRequest,
  PinRequest,
  SetLabelRequest,
  UnreadRequest,
} from './dtos/requests/conversation.request'

// Mounted under /accounts/:accountId. Changes also go out on /events as "conversations".
export const conversationRoutes = (conversations: IConversationService, messages: IMessageService) =>
  new Hono()
    .get('/conversations', (c) => c.json(conversations.settings(c.req.param('accountId')!)))
    .put('/conversations/:threadId/pin', async (c) => {
      const { isGroup, pinned } = PinRequest.parse(await c.req.json())
      await conversations.setPinned(c.req.param('accountId')!, c.req.param('threadId'), isGroup, pinned)
      return c.body(null, 204)
    })
    .put('/conversations/:threadId/mute', async (c) => {
      await conversations.setMute(c.req.param('accountId')!, c.req.param('threadId'), MuteRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .put('/conversations/:threadId/auto-delete', async (c) => {
      await conversations.setAutoDelete(c.req.param('accountId')!, c.req.param('threadId'), AutoDeleteRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .put('/conversations/:threadId/unread', async (c) => {
      const { isGroup, unread } = UnreadRequest.parse(await c.req.json())
      await conversations.setUnread(c.req.param('accountId')!, c.req.param('threadId'), isGroup, unread)
      return c.body(null, 204)
    })
    .put('/conversations/:threadId/archived', async (c) => {
      const { isGroup, archived } = ArchivedRequest.parse(await c.req.json())
      await conversations.setArchived(c.req.param('accountId')!, c.req.param('threadId'), isGroup, archived)
      return c.body(null, 204)
    })
    .put('/conversations/:threadId/label', async (c) => {
      const { isGroup, labelId } = SetLabelRequest.parse(await c.req.json())
      await conversations.setLabel(c.req.param('accountId')!, c.req.param('threadId'), isGroup, labelId)
      return c.body(null, 204)
    })
    .put('/conversations/:threadId/hidden', async (c) => {
      const { isGroup, hidden, pin } = HiddenRequest.parse(await c.req.json())
      await conversations.setHidden(c.req.param('accountId')!, c.req.param('threadId'), isGroup, hidden, pin)
      return c.body(null, 204)
    })
    // "Xóa hội thoại": the whole history, for this account only
    .delete('/conversations/:threadId', async (c) => {
      await messages.deleteConversation(c.req.param('accountId')!, c.req.param('threadId'))
      conversations.forget(c.req.param('accountId')!, c.req.param('threadId'))
      return c.body(null, 204)
    })
    .post('/labels', async (c) => {
      await conversations.createLabel(c.req.param('accountId')!, LabelRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .put('/labels/:labelId', async (c) => {
      await conversations.updateLabel(c.req.param('accountId')!, Number(c.req.param('labelId')), LabelRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .delete('/labels/:labelId', async (c) => {
      await conversations.deleteLabel(c.req.param('accountId')!, Number(c.req.param('labelId')))
      return c.body(null, 204)
    })
    .post('/hidden-chats/verify', async (c) => {
      conversations.verifyPin(c.req.param('accountId')!, PinCheckRequest.parse(await c.req.json()).pin)
      return c.body(null, 204)
    })
    .put('/hidden-chats/pin', async (c) => {
      const { oldPin, newPin } = ChangePinRequest.parse(await c.req.json())
      await conversations.changePin(c.req.param('accountId')!, oldPin, newPin)
      return c.body(null, 204)
    })
    // "Đặt lại mã PIN": the hidden conversations go with it, as on PC
    .delete('/hidden-chats/pin', async (c) => {
      const accountId = c.req.param('accountId')!
      messages.forgetThreads(accountId, await conversations.resetPin(accountId))
      return c.body(null, 204)
    })
