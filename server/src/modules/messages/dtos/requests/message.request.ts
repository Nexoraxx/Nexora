import { z } from 'zod'
import { Reactions, Urgency } from '@hwqnq/zca-js'

// Zalo PC "Định dạng tin nhắn" codes, comma-joined per run as PC's normalizeFormat: b, i, u, s, c_<hex> color,
// f_<px> size, ind_<px> indent, lst_1 bullets, lst_2 numbering
const STYLE_CODE = '(?:b|i|u|s|c_[0-9a-f]{6}|f_\\d{1,2}|ind_\\d{1,2}|lst_[12])'
const TextStyle = z.object({ start: z.number().int().min(0), len: z.number().int().positive(), st: z.string().regex(new RegExp(`^${STYLE_CODE}(?:,${STYLE_CODE})*$`)) })

export const SendMessageRequest = z.object({
  text: z.string().min(1),
  quoteMsgId: z.string().optional(),
  mentions: z.array(z.object({ uid: z.string(), pos: z.number().int().min(0), len: z.number().int().positive() })).optional(),
  styles: z.array(TextStyle).optional(),
  urgency: z.enum(Urgency).optional(),
})
export type SendMessageRequest = z.infer<typeof SendMessageRequest>

// multipart: files (1..n), optional text, optional dims = JSON [{ width, height }] in files order (images need them)
export const SendAttachmentsRequest = z.object({
  files: z.array(z.instanceof(File)).min(1),
  text: z.string().default(''),
  dims: z.array(z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).nullable()).default([]),
})
export type SendAttachmentsRequest = z.infer<typeof SendAttachmentsRequest>

// "Copy hình ảnh": a photo of a message, from Zalo's CDN
export const ImageRequest = z.object({ url: z.url({ protocol: /^https$/, error: 'Link ảnh không hợp lệ' }) })

// a file copied in the file manager and pasted (the clipboard carries its path only); this server runs on the same machine
export const LocalFileRequest = z.object({ path: z.string().startsWith('/', 'Đường dẫn không hợp lệ') })

export const SendStickerRequest = z.object({ id: z.number().int(), cateId: z.number().int(), type: z.number().int() })
export type SendStickerRequest = z.infer<typeof SendStickerRequest>

// '' removes the account's reaction
export const ReactionRequest = z.object({ icon: z.enum(Reactions) })
export type ReactionRequest = z.infer<typeof ReactionRequest>

export const ForwardRequest = z.object({ to: z.array(z.string().min(1)).min(1) })
export type ForwardRequest = z.infer<typeof ForwardRequest>

// from: jump to that message (it and everything newer)
export const HistoryRequest = z.object({ before: z.string().optional(), from: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
export type HistoryRequest = z.infer<typeof HistoryRequest>

export const MediaRequest = z.object({ kind: z.enum(['media', 'file', 'link']), limit: z.coerce.number().int().min(1).max(200).default(50) })
export type MediaRequest = z.infer<typeof MediaRequest>

export const ThreadsRequest = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
export type ThreadsRequest = z.infer<typeof ThreadsRequest>

// Zalo PC search_message.in_chat: keyword up to 100 characters, pages of up to 50
export const SearchRequest = z.object({
  q: z.string().trim().min(1).max(100, 'Vui lòng nhập ít hơn 100 ký tự'),
  fromUid: z.string().optional(),
  since: z.coerce.number().int().optional(),
  until: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
export type SearchRequest = z.infer<typeof SearchRequest>

export const UndoManyRequest = z.object({ msgIds: z.array(z.string().min(1)).min(1) })
export type UndoManyRequest = z.infer<typeof UndoManyRequest>

export const StarRequest = z.object({ starred: z.boolean() })
export type StarRequest = z.infer<typeof StarRequest>

// Zalo PC "Gửi danh thiếp": up to 9 friends, phone numbers only with "Gửi kèm số điện thoại"
export const SendCardsRequest = z.object({ userIds: z.array(z.string().min(1)).min(1).max(9, 'Bạn chỉ có thể chia sẻ 9 danh thiếp'), withPhone: z.boolean().default(false) })
export type SendCardsRequest = z.infer<typeof SendCardsRequest>

export const LinkPreviewRequest = z.object({ url: z.string().min(1) })

const Mention = z.object({ uid: z.string(), pos: z.number().int().min(0), len: z.number().int().positive() })
// the composer's whole text plus the preview it showed (GET /link-preview)
export const SendLinkRequest = z.object({
  text: z.string().min(1),
  preview: z.object({ href: z.string().min(1), title: z.string(), desc: z.string(), thumb: z.string(), src: z.string(), media: z.object({ type: z.number().optional() }).passthrough().nullable() }),
  mentions: z.array(Mention).optional(),
})
export type SendLinkRequest = z.infer<typeof SendLinkRequest>

export const GifsRequest = z.object({ q: z.string().default(''), offset: z.coerce.number().int().min(0).default(0) })

// a GIF as GET /gifs lists it: url = original, thumb = normal (what the bubble shows)
export const Gif = z.object({ id: z.string(), url: z.string().min(1), thumb: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive() })
export type Gif = z.infer<typeof Gif>
