import { afterEach, expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { openDatabase } from '../../dbs/sqlite'
import type { ZcaService } from '../../third-party/zalo/zalo-client'
import StickerRepository from './repositories/implements/sticker-repository'
import StickerService from './services/implements/sticker-service'

const cate = (id: number, type = 1, status = 0, is_hidden = 0) => ({ id, name: `Bộ ${id}`, iconUrl: `icon${id}`, totalImage: 2, version: 1, type, status, is_hidden })
const sticker = (cateId: number, id: number, extra = {}) =>
  ({ id, cateId, type: 7, text: '', stickerUrl: `png${id}`, stickerWebpUrl: null, stickerSpriteUrl: null, totalFrames: 1, duration: 0, ext: 0, effectId: 0, extInfo: null, version: 0, ...extra }) as never
const realFetch = globalThis.fetch
afterEach(() => void (globalThis.fetch = realFetch))

const setup = (catalogText: string, cs: string) => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  globalThis.fetch = mock(async () => new Response(catalogText)) as never
  const api = {
    getPersonalizedStickers: mock(async () => ({ sticker_cates: [5, 7, 0], version: 3, removeSticker: [{ sticker_id: 502 }], expired_time: 600 })),
    getStickerCategories: mock(async () => ({ dataUrl: 'http://cdn/cates.json', cs, data: [cate(5), cate(6)], exCateIds: [9] })),
    getStickerCategoryInfo: mock(async (id: number) => cate(id, 1, 0, 6)),
    getStickerCategoryDetail: mock(async (id: number) => [
      sticker(id, 501, { stickerSpriteUrl: 'strip501', totalFrames: 4, duration: 100 }),
      sticker(id, 502),
      sticker(id, 503, { stickerWebpUrl: 'webp503', stickerSpriteUrl: 'anim503', ext: 2, version: 9 }),
    ]),
    updatePersonalizedStickers: mock(async () => ({ data: { version: 4 } })),
    searchSticker: mock(async () => [{ sticker_id: 501, cate_id: 5, type: 7 }, { sticker_id: 801, cate_id: 8, type: 7 }]),
    getStickersDetail: mock(async (ids: number | number[]) => [ids].flat().map((id) => sticker(id >= 800 ? 8 : 5, id, id === 802 ? { effectId: 3 } : {}))),
  }
  const zca = Object.assign(new EventEmitter(), { get: () => api, has: () => true }) as unknown as ZcaService
  return { db, api, zca, stickers: new StickerService(new StickerRepository(db), zca) }
}
const md5 = (s: string) => createHash('md5').update(s + 'qebjuzwihygr').digest('hex')

test('categories follow the personalized order; the catalog comes from dataUrl only when its checksum matches', async () => {
  const catalog = JSON.stringify([cate(5, 1, 1), cate(6, 2), cate(8, 1, 4), cate(9), cate(10, 1, 0, 5)])
  const { api, stickers } = setup(catalog, md5(catalog))
  expect((await stickers.categories('me')).map((c) => c.id)).toEqual([5, 7, 0])
  // 7 isn't in the catalog: fetched on its own
  expect(api.getStickerCategoryInfo).toHaveBeenCalledWith(7)
  // store: hidden (10) and excluded (9) dropped, sorted by type desc then status desc (4 counts as 0)
  expect((await stickers.store('me')).map((c) => [c.id, c.added])).toEqual([
    [6, false],
    [5, true],
    [8, false],
  ])

  const bad = setup('[{"id":1}]', 'nope')
  expect((await bad.stickers.store('me')).map((c) => c.id)).toEqual([5, 6])
})

test('category stickers are cached, removed ones hidden, animation mapped; built-in served locally', async () => {
  const { api, stickers } = setup('[]', '')
  const items = await stickers.stickers('me', 5)
  expect(items.map((s) => s.id)).toEqual([501, 503])
  expect(items[0].anim).toEqual({ url: 'strip501', frames: 4, duration: 100 })
  expect(items[1]).toMatchObject({ thumb: 'webp503?version=9', anim: { url: 'anim503?version=9', frames: 1 } })
  await stickers.stickers('me', 5)
  expect(api.getStickerCategoryDetail).toHaveBeenCalledTimes(1)
  expect((await stickers.stickers('me', 0)).length).toBe(30)
})

test('own sticker messages fill recents (max 12, newest first, no effects); adding a category bumps the version; search fills details', async () => {
  const { zca, api, stickers } = setup('[]', '')
  const sent = (id: number, catId: number) => zca.emit('message', 'me', { isSelf: true, data: { msgType: 'chat.sticker', content: { id, catId, type: 7 } } } as never)
  sent(801, 8)
  sent(1, 0)
  sent(802, 8) // effect sticker
  zca.emit('message', 'me', { isSelf: false, data: { msgType: 'chat.sticker', content: { id: 803, catId: 8 } } } as never)
  await Bun.sleep(5)
  sent(801, 8)
  await Bun.sleep(5)
  expect(stickers.recent('me').map((s) => s.id)).toEqual([801, 1])
  for (let i = 1; i <= 14; i++) sent(i, 0)
  await Bun.sleep(5)
  expect(stickers.recent('me')).toHaveLength(12)

  await stickers.setAdded('me', 8, true)
  expect(api.updatePersonalizedStickers).toHaveBeenLastCalledWith([8, 5, 7, 0], 3)
  await stickers.setAdded('me', 8, true)
  await stickers.setAdded('me', 5, false)
  expect(api.updatePersonalizedStickers).toHaveBeenLastCalledWith([8, 7, 0], 4)
  expect(api.updatePersonalizedStickers).toHaveBeenCalledTimes(2)

  api.getStickersDetail.mockClear()
  // 801 is cached from recents: only 501 needs details
  expect((await stickers.search('me', 'hi')).map((s) => s.id)).toEqual([501, 801])
  expect(api.getStickersDetail).toHaveBeenCalledWith([501])
})

test('typing suggestions: keywords once, suggest/stickers through custom(), cached per keyword, removed and effect stickers dropped', async () => {
  const { api, stickers } = setup('[]', '')
  const requested: string[] = []
  const extra = {
    zpwServiceMap: { sticker: ['https://sticker-wpa'] },
    getStickerSuggestKeywords: mock(async () => ({ keywords: ['hi', 'chào bạn'], word_search: 3 })),
    custom: mock((name: string, cb: (p: unknown) => unknown) => {
      ;(api as Record<string, unknown>)[name] = (props: unknown) =>
        cb({
          ctx: { imei: 'imei' },
          props,
          utils: {
            encodeAES: (s: string) => s,
            makeURL: (url: string, p: Record<string, string>) => `${url}?params=${p.params}`,
            request: async (url: string) => (requested.push(url), new Response('')),
            resolve: async () => ({ sugg_sticker: [{ sticker_id: 801, cate_id: 8 }, { sticker_id: 802, cate_id: 8 }, { sticker_id: 502, cate_id: 5 }], expired_time: 60 }),
          },
        })
    }),
  }
  Object.assign(api, extra)

  expect(await stickers.suggestKeywords('me')).toEqual({ keywords: ['hi', 'chào bạn'], maxWords: 3 })
  await stickers.suggestKeywords('me')
  expect(extra.getStickerSuggestKeywords).toHaveBeenCalledTimes(1)

  await stickers.stickers('me', 5) // loads the personal list (502 removed)
  expect((await stickers.suggest('me', 'hi')).map((s) => s.id)).toEqual([801])
  expect(requested).toEqual(['https://sticker-wpa/api/message/sticker/suggest/stickers?params={"keyword":"hi","gif":1,"guggy":0,"imei":"imei"}'])
  await stickers.suggest('me', 'hi')
  expect(requested).toHaveLength(1)
  expect(extra.custom).toHaveBeenCalledTimes(1)
})
