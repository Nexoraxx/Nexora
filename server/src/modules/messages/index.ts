import { Hono } from 'hono'
import type IMessageService from './services/interfaces/message-service'
import {
  ForwardRequest,
  Gif,
  GifsRequest,
  HistoryRequest,
  ImageRequest,
  LocalFileRequest,
  LinkPreviewRequest,
  MediaRequest,
  ReactionRequest,
  SearchRequest,
  SendAttachmentsRequest,
  SendCardsRequest,
  SendLinkRequest,
  SendMessageRequest,
  SendStickerRequest,
  StarRequest,
  ThreadsRequest,
  UndoManyRequest,
} from './dtos/requests/message.request'
import { parseE2eeKey, stripE2eeParams, decryptE2eeMedia } from '../../third-party/signal/e2ee-content'
import { list, mimeOf } from './helpers/message.helper'
import type { Sync2Service } from '../../third-party/sync2/sync2-service'

// Mounted under /accounts/:accountId. Live updates go out on /events: message, undo, reaction, receipt, typing, threads.
export const messageRoutes = (messages: IMessageService, sync: Sync2Service) =>
  new Hono()
    // "Đồng bộ tin nhắn" from the phone; progress also goes out on /events as sync_status
    .get('/sync', (c) => c.json(sync.status(c.req.param('accountId')!)))
    .post('/sync', (c) => c.json(sync.start(c.req.param('accountId')!)))
    .delete('/sync', (c) => {
      sync.cancel(c.req.param('accountId')!)
      return c.body(null, 204)
    })
    .get('/threads', (c) => {
      const { limit } = ThreadsRequest.parse(c.req.query())
      return c.json(messages.threads(c.req.param('accountId')!, limit))
    })
    .get('/threads/:threadId/messages', async (c) => {
      const { before, from, limit } = HistoryRequest.parse(c.req.query())
      return c.json(await messages.history(c.req.param('accountId')!, c.req.param('threadId'), before, limit, from))
    })
    .get('/threads/:threadId/search', (c) => c.json(messages.search(c.req.param('accountId')!, c.req.param('threadId'), SearchRequest.parse(c.req.query()))))
    .get('/starred', (c) => c.json(messages.starred(c.req.param('accountId')!)))
    .get('/threads/:threadId/media', (c) => {
      const { kind, limit } = MediaRequest.parse(c.req.query())
      return c.json(messages.media(c.req.param('accountId')!, c.req.param('threadId'), kind, limit))
    })
    .post('/threads/:threadId/messages', async (c) => {
      const body = SendMessageRequest.parse(await c.req.json())
      return c.json(await messages.sendText(c.req.param('accountId')!, c.req.param('threadId'), body))
    })
    // the bytes of a message photo (clipboard, and the only way to show E2EE media): the webview can't read Zalo's CDN
    // across origins, and an E2EE blob must be AES-decrypted with the key in its href's e2esession= param
    .get('/image', async (c) => {
      const url = ImageRequest.parse(c.req.query()).url
      const key = parseE2eeKey(url)
      const res = await fetch(key ? stripE2eeParams(url) : url)
      if (!res.ok) return c.json({ error: 'Không tải được ảnh' }, 502)
      const buf = Buffer.from(await res.arrayBuffer())
      try {
        const body = key ? decryptE2eeMedia(buf, key) : buf
        return c.body(new Uint8Array(body), 200, { 'content-type': key ? mimeOf(url) : (res.headers.get('content-type') ?? 'image/jpeg') })
      } catch (e) {
        console.error('[e2ee] media decrypt', e)
        return c.json({ error: 'Không giải mã được tệp mã hóa đầu cuối' }, 502)
      }
    })
    // the bytes of a pasted file path (PC's _uploadFileFromPaths); then sent like a picked file
    .get('/local-file', async (c) => {
      const file = Bun.file(LocalFileRequest.parse(c.req.query()).path)
      if (!(await file.exists())) return c.json({ error: 'Không đọc được file' }, 404)
      return c.body(await file.arrayBuffer(), 200, { 'content-type': file.type })
    })
    .post('/threads/:threadId/attachments', async (c) => {
      const form = await c.req.parseBody({ all: true })
      const body = SendAttachmentsRequest.parse({
        files: list(form.files),
        text: typeof form.text === 'string' ? form.text : undefined,
        dims: typeof form.dims === 'string' ? JSON.parse(form.dims) : undefined,
      })
      return c.json(await messages.sendAttachments(c.req.param('accountId')!, c.req.param('threadId'), body))
    })
    .post('/threads/:threadId/stickers', async (c) => {
      const body = SendStickerRequest.parse(await c.req.json())
      return c.json(await messages.sendSticker(c.req.param('accountId')!, c.req.param('threadId'), body))
    })
    .post('/threads/:threadId/cards', async (c) => {
      await messages.sendCards(c.req.param('accountId')!, c.req.param('threadId'), SendCardsRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .get('/link-preview', async (c) => c.json(await messages.linkPreview(c.req.param('accountId')!, LinkPreviewRequest.parse(c.req.query()).url)))
    .post('/threads/:threadId/links', async (c) => {
      await messages.sendLink(c.req.param('accountId')!, c.req.param('threadId'), SendLinkRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .get('/gifs', async (c) => {
      const { q, offset } = GifsRequest.parse(c.req.query())
      return c.json(await messages.gifs(c.req.param('accountId')!, q, offset))
    })
    .post('/threads/:threadId/gifs', async (c) => {
      await messages.sendGif(c.req.param('accountId')!, c.req.param('threadId'), Gif.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .post('/threads/:threadId/seen', async (c) => {
      await messages.markSeen(c.req.param('accountId')!, c.req.param('threadId'))
      return c.body(null, 204)
    })
    .post('/threads/:threadId/typing', async (c) => {
      await messages.typing(c.req.param('accountId')!, c.req.param('threadId'))
      return c.body(null, 204)
    })
    .post('/threads/:threadId/messages/:msgId/reactions', async (c) => {
      const { icon } = ReactionRequest.parse(await c.req.json())
      await messages.react(c.req.param('accountId')!, c.req.param('threadId'), c.req.param('msgId'), icon)
      return c.body(null, 204)
    })
    .post('/threads/:threadId/messages/:msgId/undo', async (c) => {
      await messages.undo(c.req.param('accountId')!, c.req.param('threadId'), c.req.param('msgId'))
      return c.body(null, 204)
    })
    .post('/threads/:threadId/undo', async (c) => {
      const { msgIds } = UndoManyRequest.parse(await c.req.json())
      await messages.undoMany(c.req.param('accountId')!, c.req.param('threadId'), msgIds)
      return c.body(null, 204)
    })
    .put('/threads/:threadId/messages/:msgId/star', async (c) => {
      const { starred } = StarRequest.parse(await c.req.json())
      messages.star(c.req.param('accountId')!, c.req.param('msgId'), starred)
      return c.body(null, 204)
    })
    .get('/threads/:threadId/messages/:msgId/info', async (c) => c.json(await messages.info(c.req.param('accountId')!, c.req.param('threadId'), c.req.param('msgId'))))
    .delete('/threads/:threadId/messages/:msgId', async (c) => {
      await messages.deleteForMe(c.req.param('accountId')!, c.req.param('threadId'), c.req.param('msgId'))
      return c.body(null, 204)
    })
    .post('/threads/:threadId/messages/:msgId/forward', async (c) => {
      const { to } = ForwardRequest.parse(await c.req.json())
      return c.json(await messages.forward(c.req.param('accountId')!, c.req.param('threadId'), c.req.param('msgId'), to))
    })
