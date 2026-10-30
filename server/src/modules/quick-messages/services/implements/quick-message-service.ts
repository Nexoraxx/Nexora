import { inject, injectable } from 'inversify'
import { HTTPException } from 'hono/http-exception'
import { ZaloApiError, type API } from '@hwqnq/zca-js'
import { broadcast } from '../../../../core'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import { zaloGet } from '../../../../third-party/zalo/post'
import type { QuickMessageRequest } from '../../dtos/requests/quick-message.request'
import type { QuickMessage } from '../../dtos/responses/quick-message.response'
import type IQuickMessageService from '../interfaces/quick-message-service'

// Zalo PC quick_message defaults: max_creation_quantity, supported_types (0 text, 1 with a photo)
const MAX_ITEMS = 50
const SUPPORTED = [0, 1]
// error codes of create / update
const ERRORS: Record<number, string> = { 820: 'Phím tắt đã được sử dụng' }

type Media = { items?: { type?: number; thumbUrl?: string; rawUrl?: string; hdUrl?: string; normalUrl?: string }[] } | null
type Item = { id: number | string; keyword: string; type: number; message?: { title?: string; params?: string } | null; media?: Media; lastModified?: number }

// Zalo PC's "Tin nhắn nhanh": the list is read once per session and kept, then refetched after a change from here
// or from another device (control quick_message). All four calls are GETs, as PC sends them; zca's update would drop
// an item's photo (no media, type 0), so the item's media goes back as it is.
// ponytail: text items only are created here; PC also uploads one photo per item
@injectable()
export default class QuickMessageService implements IQuickMessageService {
  private cache = new Map<string, Promise<Item[]>>()

  constructor(@inject(ZcaService) private zca: ZcaService) {
    zca.on('attached', (id) => this.cache.delete(id))
    zca.on('control', (id, c) => c.act_type === 'quick_message' && this.changed(id))
  }

  async list(accountId: string) {
    return { items: (await this.items(accountId)).map(view), max: MAX_ITEMS }
  }

  async create(accountId: string, { keyword, title }: QuickMessageRequest) {
    const items = await this.items(accountId)
    if (items.length >= MAX_ITEMS) throw new HTTPException(400, { message: `Đạt giới hạn ${MAX_ITEMS} tin nhắn nhanh. Vui lòng xóa tin nhắn cũ để cập nhật tin nhắn mới` })
    if (items.some((i) => i.keyword === keyword)) throw new HTTPException(400, { message: ERRORS[820] })
    if (!title) throw new HTTPException(400, { message: 'Nhập nội dung tin nhắn' })
    const api = this.zca.get(accountId)
    await zaloGet(api, 'quick_message', '/api/quickmessage/create', { keyword, message: { title, params: '' }, type: 0, imei: api.getContext().imei }).catch(explain)
    this.changed(accountId)
  }

  async update(accountId: string, id: string, { keyword, title }: QuickMessageRequest) {
    const item = (await this.items(accountId)).find((i) => String(i.id) === id)
    if (!item) throw new HTTPException(404, { message: 'Không tìm thấy tin nhắn nhanh' })
    const media = item.media?.items?.length ? item.media : null
    if (!title && !media) throw new HTTPException(400, { message: 'Nhập nội dung tin nhắn' })
    await zaloGet(this.zca.get(accountId), 'quick_message', '/api/quickmessage/update', {
      itemId: item.id,
      keyword,
      message: { title, params: item.message?.params ?? '' },
      media,
      type: media ? 1 : 0,
    }).catch(explain)
    this.changed(accountId)
  }

  async remove(accountId: string, id: string) {
    const item = (await this.items(accountId)).find((i) => String(i.id) === id)
    if (!item) return
    await zaloGet(this.zca.get(accountId), 'quick_message', '/api/quickmessage/delete', { itemIds: [item.id] })
    this.changed(accountId)
  }

  // 212 = none yet
  private items(accountId: string) {
    let items = this.cache.get(accountId)
    if (!items) {
      const api = this.zca.get(accountId)
      items = fetchList(api).then((list) =>
        list.filter((i) => SUPPORTED.includes(i.type)).sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0)),
      )
      this.cache.set(accountId, items)
      items.catch(() => this.cache.delete(accountId))
    }
    return items
  }

  private changed(accountId: string) {
    this.cache.delete(accountId)
    broadcast({ type: 'quick_messages', accountId })
  }
}

// lang: PC's UI language index, 0 = Vietnamese
const fetchList = (api: API) =>
  zaloGet<{ items?: Item[] }>(api, 'quick_message', '/api/quickmessage/list', { version: 0, lang: 0, imei: api.getContext().imei })
    .then((r) => r.items ?? [])
    .catch((e) => {
      if (e instanceof ZaloApiError && e.code === 212) return []
      throw e
    })

const view = (i: Item): QuickMessage => {
  const photo = i.media?.items?.[0]
  return {
    id: String(i.id),
    keyword: i.keyword,
    title: i.message?.title ?? '',
    photo: photo?.type === 0 ? (photo.thumbUrl || photo.rawUrl || photo.hdUrl || photo.normalUrl || null) : null,
    lastModified: Number(i.lastModified ?? 0),
  }
}

const explain = (e: unknown): never => {
  const text = e instanceof ZaloApiError && e.code != null ? ERRORS[e.code] : undefined
  throw text ? new HTTPException(400, { message: text }) : e
}
