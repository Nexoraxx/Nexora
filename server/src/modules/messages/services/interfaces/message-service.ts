import type { ForwardMessageFail, ForwardMessageSuccess, Reactions } from '@hwqnq/zca-js'
import type { Gif, SearchRequest, SendAttachmentsRequest, SendCardsRequest, SendLinkRequest, SendMessageRequest, SendStickerRequest } from '../../dtos/requests/message.request'
import type { LinkPreview, MediaKind, MessageInfo, MessageRow, Thread } from '../../dtos/responses/message.response'

export default interface IMessageService {
  threads(accountId: string, limit: number): Thread[]
  history(accountId: string, threadId: string, before: string | undefined, limit: number, from?: string): Promise<{ messages: MessageRow[]; hasMore: boolean }>
  media(accountId: string, threadId: string, kind: MediaKind, limit: number): { content: any; msgId: string; msgType: string; sendDttm: number }[]
  search(accountId: string, threadId: string, body: SearchRequest): MessageRow[]
  starred(accountId: string): MessageRow[]
  info(accountId: string, threadId: string, msgId: string): Promise<MessageInfo>
  sendText(accountId: string, threadId: string, req: SendMessageRequest): Promise<{ msgId: string | undefined }>
  sendAttachments(accountId: string, threadId: string, body: SendAttachmentsRequest): Promise<{ msgIds: string[] }>
  sendSticker(accountId: string, threadId: string, sticker: SendStickerRequest): Promise<{ msgId: string }>
  sendCards(accountId: string, threadId: string, body: SendCardsRequest): Promise<void>
  linkPreview(accountId: string, url: string): Promise<LinkPreview | null>
  sendLink(accountId: string, threadId: string, body: SendLinkRequest): Promise<void>
  gifs(accountId: string, q: string, offset: number): Promise<Gif[]>
  sendGif(accountId: string, threadId: string, gif: Gif): Promise<void>
  react(accountId: string, threadId: string, msgId: string, icon: Reactions): Promise<void>
  undo(accountId: string, threadId: string, msgId: string): Promise<void>
  undoMany(accountId: string, threadId: string, msgIds: string[]): Promise<void>
  star(accountId: string, msgId: string, starred: boolean): void
  deleteForMe(accountId: string, threadId: string, msgId: string): Promise<void>
  deleteConversation(accountId: string, threadId: string): Promise<void>
  forgetThreads(accountId: string, threadIds: string[]): void
  forward(accountId: string, threadId: string, msgId: string, to: string[]): Promise<{ success: ForwardMessageSuccess[]; fail: ForwardMessageFail[] } | { success: { clientId: string; msgId: string; threadId: string }[]; fail: { threadId: string; error_code: string }[] }>
  markSeen(accountId: string, threadId: string): Promise<void>
  typing(accountId: string, threadId: string): Promise<void>
  leftGroup(accountId: string, groupId: string): void
}
