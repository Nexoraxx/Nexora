import { createHash } from 'node:crypto'
import { inject, injectable } from 'inversify'
import type { API, Message, StickerCategory, StickerDetail } from '@hwqnq/zca-js'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import { TOKENS } from '../../../../di/tokens'
import type { StickerItem, StickerCategoryItem } from '../../dtos/responses/sticker.response'
import type IStickerRepository from '../../repositories/interfaces/sticker-repository'
import type { StickerRow } from '../../repositories/interfaces/sticker-repository'
import type IStickerService from '../interfaces/sticker-service'

// Zalo PC sticker constants (renderer module ynGT)
const BUILTIN_CATE = 0 // "Củ hành", shipped with the app
const BUILTIN_COUNT = 30
const BUILTIN_BASE = 'https://stc-chat.zdn.vn/images/stickers/default/'
const CATALOG_SALT = 'qebjuzwihygr' // dataUrl is trusted only when md5(text + salt) === cs
const MAX_RECENT = 12
const EXT_WEBP = 2 // STICKER_EXT { PNG: 0, JPG: 1, WEBP: 2 }
const DAY = 24 * 3600e3
// ponytail: a category's stickers are refetched weekly; Zalo compares the category version instead
const STICKERS_STALE = 7 * DAY

type SuggestResponse = { sugg_sticker?: { sticker_id: number; cate_id: number }[] | null; expired_time?: number }
type SuggestApi = (props: { keyword: string }) => Promise<SuggestResponse>
// registered on each API instance via zca's custom(); zca's getStickers hits an older path
const SUGGEST_API = 'nexoraStickerSuggest'
type Personal = { cates: number[]; version: number; removed: number[]; expiresAt: number }
type Recent = { id: number; cateId: number }

const BUILTIN: StickerItem[] = Array.from({ length: BUILTIN_COUNT }, (_, i) => ({
  id: i + 1,
  cateId: BUILTIN_CATE,
  type: 7,
  text: '',
  thumb: `${BUILTIN_BASE}thumb/${i + 1}.png`,
  anim: { url: `${BUILTIN_BASE}${i + 1}.gif`, frames: 1, duration: 0 },
}))
const BUILTIN_CATEGORY: StickerCategoryItem = { id: BUILTIN_CATE, name: 'Củ hành', iconUrl: BUILTIN[0].thumb, totalImage: BUILTIN_COUNT }

const versioned = (url: string, version?: number | null) => (version ? `${url}${url.includes('?') ? '&' : '?'}version=${version}` : url)

// Zalo PC: thumb is the webp (else png); the sprite plays when the sticker is webp or has more than one frame
const toItem = (s: StickerDetail): StickerItem => ({
  id: s.id,
  cateId: s.cateId,
  type: s.type,
  text: s.text ?? '',
  thumb: versioned(s.stickerWebpUrl ?? s.stickerUrl, s.version),
  anim:
    s.stickerSpriteUrl && (s.ext === EXT_WEBP || s.totalFrames > 1)
      ? { url: versioned(s.stickerSpriteUrl, s.version), frames: s.ext === EXT_WEBP ? 1 : s.totalFrames, duration: s.duration || 250 }
      : null,
})

const toCategory = (c: StickerCategory): StickerCategoryItem => ({ id: c.id, name: c.name, iconUrl: c.iconUrl, totalImage: c.totalImage })

// Zalo PC store order: type desc, then status desc with status 4 counted as 0
const storeOrder = (a: StickerCategory, b: StickerCategory) => {
  const status = (c: StickerCategory) => (c.status === 4 ? 0 : c.status)
  return a.type === b.type ? status(b) - status(a) : b.type - a.type
}

@injectable()
export default class StickerService implements IStickerService {
  // the category catalog, suggestion keywords and per-keyword suggestions are the same for every account
  private catalog?: { at: number; list: StickerCategory[] }
  private keywords?: { at: number; keywords: string[]; maxWords: number }
  private suggestions = new Map<string, { expiresAt: number; stickers: { sticker_id: number; cate_id: number }[] }>()

  constructor(
    @inject(TOKENS.StickerRepository) private stickerRepo: IStickerRepository,
    @inject(ZcaService) private zca: ZcaService,
  ) {
    // Zalo PC records a recent sticker when the account's own sticker message comes back (from any device)
    zca.on('message', (accountId, m: Message) => {
      if (m.isSelf && m.data.msgType === 'chat.sticker')
        void this.addRecent(accountId, m.data.content as { id: number; catId: number }).catch((e) => console.error('[stickers] recent', e))
    })
  }

  // The account's sticker bar: its personalized categories, in its order.
  async categories(accountId: string) {
    const api = this.zca.get(accountId)
    const [{ cates }, all] = await Promise.all([this.personal(accountId, api), this.allCategories(api)])
    const byId = new Map(all.map((c) => [c.id, c]))
    const out: StickerCategoryItem[] = []
    for (const id of cates) {
      if (id === BUILTIN_CATE) out.push(BUILTIN_CATEGORY)
      else {
        // not in the catalog (private/exclusive sets): ask for that one category
        const c = byId.get(id) ?? (await api.getStickerCategoryInfo(id).catch(() => undefined))
        if (c?.id) out.push(toCategory(c))
      }
    }
    return out
  }

  // Sticker store: public categories, marked when already added.
  async store(accountId: string) {
    const api = this.zca.get(accountId)
    const [{ cates }, all] = await Promise.all([this.personal(accountId, api), this.allCategories(api)])
    return all
      .filter((c) => !c.is_hidden)
      .sort(storeOrder)
      .map((c) => ({ ...toCategory(c), added: cates.includes(c.id) }))
  }

  async stickers(accountId: string, cateId: number) {
    if (cateId === BUILTIN_CATE) return BUILTIN
    const api = this.zca.get(accountId)
    const { removed } = await this.personal(accountId, api)
    let rows: StickerDetail[] = this.stickerRepo.fresh(cateId, Date.now() - STICKERS_STALE)
    if (!rows.length) {
      rows = await api.getStickerCategoryDetail(cateId)
      this.stickerRepo.cache(rows)
    }
    return rows.filter((s) => !removed.includes(s.id)).map(toItem)
  }

  recent(accountId: string): StickerItem[] {
    return (this.stickerRepo.kvGet<Recent[]>(accountId, 'recent_stickers') ?? [])
      .map((r) => {
        if (r.cateId === BUILTIN_CATE) return BUILTIN[r.id - 1]
        const row = this.stickerRepo.row(r.cateId, r.id)
        return row && toItem(row)
      })
      .filter((s): s is StickerItem => !!s)
  }

  // Zalo PC's panel search (/sticker/search), details from cache first.
  async search(accountId: string, keyword: string) {
    const api = this.zca.get(accountId)
    const found = await api.searchSticker(keyword, 50)
    const missing = found.filter((f) => !this.stickerRepo.row(f.cate_id, f.sticker_id)).map((f) => f.sticker_id)
    if (missing.length) this.stickerRepo.cache(await api.getStickersDetail(missing))
    return found.map((f) => this.stickerRepo.row(f.cate_id, f.sticker_id)).filter((s): s is StickerRow => !!s).map(toItem)
  }

  // Keywords the composer matches while typing (Zalo PC: suggest/keywords, word_search = longest phrase in words).
  async suggestKeywords(accountId: string) {
    if (!this.keywords || Date.now() - this.keywords.at > DAY) {
      const res = await this.zca.get(accountId).getStickerSuggestKeywords()
      this.keywords = { at: Date.now(), keywords: res.keywords ?? [], maxWords: res.word_search || 1 }
    }
    return { keywords: this.keywords.keywords, maxWords: this.keywords.maxWords }
  }

  // Stickers for a matched keyword (Zalo PC: suggest/stickers, cached per keyword until expired_time).
  async suggest(accountId: string, keyword: string) {
    const api = this.zca.get(accountId)
    let cached = this.suggestions.get(keyword)
    if (!cached || cached.expiresAt < Date.now()) {
      if (!(SUGGEST_API in api))
        api.custom<SuggestResponse, { keyword: string }>(SUGGEST_API, async ({ ctx, utils, props }) => {
          const params = utils.encodeAES(JSON.stringify({ keyword: props.keyword, gif: 1, guggy: 0, imei: ctx.imei }))
          if (!params) throw new Error('Failed to encrypt params')
          const url = utils.makeURL(`${api.zpwServiceMap.sticker[0]}/api/message/sticker/suggest/stickers`, { params })
          return utils.resolve(await utils.request(url))
        })
      const res = await (api as unknown as Record<string, SuggestApi>)[SUGGEST_API]({ keyword })
      cached = { expiresAt: Date.now() + (res.expired_time || 3600) * 1000, stickers: res.sugg_sticker ?? [] }
      this.suggestions.set(keyword, cached)
    }
    const removed = this.stickerRepo.kvGet<Personal>(accountId, 'sticker_personal')?.removed ?? []
    const wanted = cached.stickers.filter((s) => !removed.includes(s.sticker_id))
    const missing = wanted.filter((s) => !this.stickerRepo.row(s.cate_id, s.sticker_id)).map((s) => s.sticker_id)
    if (missing.length) this.stickerRepo.cache(await api.getStickersDetail(missing))
    return wanted.map((s) => this.stickerRepo.row(s.cate_id, s.sticker_id)).filter((s): s is StickerRow => !!s && !s.effectId).map(toItem)
  }

  // Zalo PC adds a category to the front of the list; personalized/update needs the current version.
  async setAdded(accountId: string, cateId: number, added: boolean) {
    const api = this.zca.get(accountId)
    const personal = await this.personal(accountId, api)
    if (added === personal.cates.includes(cateId)) return
    const cates = added ? [cateId, ...personal.cates] : personal.cates.filter((id) => id !== cateId)
    const res = (await api.updatePersonalizedStickers(cates, personal.version)) as { data?: { version?: number }; version?: number }
    this.stickerRepo.kvSet(accountId, 'sticker_personal', { ...personal, cates, version: res?.data?.version ?? res?.version ?? personal.version })
  }

  private async addRecent(accountId: string, { id, catId }: { id: number; catId: number }) {
    if (!Number.isInteger(id) || !Number.isInteger(catId)) return
    if (catId !== BUILTIN_CATE && !this.stickerRepo.row(catId, id) && this.zca.has(accountId)) this.stickerRepo.cache(await this.zca.get(accountId).getStickersDetail(id))
    const detail = this.stickerRepo.row(catId, id)
    // effect stickers and stickers the account removed never show up in recents
    if (detail?.effectId || (detail?.extInfo && detail.extInfo !== 'null')) return
    if (this.stickerRepo.kvGet<Personal>(accountId, 'sticker_personal')?.removed.includes(id)) return
    const recent = (this.stickerRepo.kvGet<Recent[]>(accountId, 'recent_stickers') ?? []).filter((r) => !(r.id === id && r.cateId === catId))
    this.stickerRepo.kvSet(accountId, 'recent_stickers', [{ id, cateId: catId }, ...recent].slice(0, MAX_RECENT))
  }

  private async personal(accountId: string, api: API): Promise<Personal> {
    const cached = this.stickerRepo.kvGet<Personal>(accountId, 'sticker_personal')
    if (cached && cached.expiresAt > Date.now()) return cached
    try {
      const res = await api.getPersonalizedStickers()
      const personal = {
        cates: res.sticker_cates ?? [BUILTIN_CATE],
        version: res.version ?? 0,
        removed: (res.removeSticker ?? []).map((s) => s.sticker_id),
        expiresAt: Date.now() + (res.expired_time ?? 3600) * 1000,
      }
      this.stickerRepo.kvSet(accountId, 'sticker_personal', personal)
      return personal
    } catch (e) {
      if (cached) return cached
      throw e
    }
  }

  private async allCategories(api: API) {
    if (this.catalog && Date.now() - this.catalog.at < DAY) return this.catalog.list
    const res = await api.getStickerCategories()
    let list = res.data ?? []
    if (res.dataUrl) {
      const text = await fetch(res.dataUrl.replace(/^http:/, 'https:'))
        .then((r) => r.text())
        .catch(() => '')
      if (text && createHash('md5').update(text + CATALOG_SALT).digest('hex') === res.cs?.toLowerCase()) {
        try {
          list = JSON.parse(text)
        } catch (e) {
          console.error('[stickers] catalog parse', e)
        }
      }
    }
    const excluded = new Set(res.exCateIds ?? [])
    list = list.filter((c) => c?.id && !excluded.has(c.id))
    this.catalog = { at: Date.now(), list }
    return list
  }
}
