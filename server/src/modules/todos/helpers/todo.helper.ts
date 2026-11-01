import type { API } from '@hwqnq/zca-js'
import { parseBig } from '../../../third-party/zalo/post'
import type { Ref } from '../models/todo.model'

// PC's task_setting defaults to enable_feature 0: To-Do stays off unless Zalo turns it on for the account
export const enabled = (api: API) => api.getContext().settings?.features?.task_setting?.enable_feature === 1

export const refs = (v: Ref[] | string | undefined) => (parseBig<Ref[] | null>(v ?? []) ?? []).filter((r) => r != null)
export const idOf = (r: Ref) => String(typeof r === 'object' ? (r.uid ?? r.userId ?? r.id) : r)
