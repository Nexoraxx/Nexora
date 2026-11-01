import { ZaloApiError, type API } from '@hwqnq/zca-js'
import { zaloGet } from '../../../third-party/zalo/post'
import type { QuickMessage } from '../dtos/responses/quick-message.response'
import type { Item } from '../models/quick-message.model'

// lang: PC's UI language index, 0 = Vietnamese
export const fetchList = (api: API) =>
  zaloGet<{ items?: Item[] }>(api, 'quick_message', '/api/quickmessage/list', { version: 0, lang: 0, imei: api.getContext().imei })
    .then((r) => r.items ?? [])
    .catch((e) => {
      if (e instanceof ZaloApiError && e.code === 212) return []
      throw e
    })

export const view = (i: Item): QuickMessage => {
  const photo = i.media?.items?.[0]
  return {
    id: String(i.id),
    keyword: i.keyword,
    title: i.message?.title ?? '',
    photo: photo?.type === 0 ? (photo.thumbUrl || photo.rawUrl || photo.hdUrl || photo.normalUrl || null) : null,
    lastModified: Number(i.lastModified ?? 0),
  }
}
