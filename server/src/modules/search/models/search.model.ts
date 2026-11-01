import type { SearchMessage } from '../dtos/responses/search.response'

export type ContactRow = { userId: string; isGroup: number; alias: string | null; displayName: string | null; zaloName: string | null; avatar: string | null; isFr: number; last: number | null }
export type MessageHit = Omit<SearchMessage, 'isGroup' | 'content'> & { isGroup: number | null; message: string | null }

export type RecentItem = { id: string; type: number; last_update_time?: number }
export type RecentKeyword = { key: string; last_update_time?: number }
export type RecentList = { list_recent?: RecentItem[]; list_keyword?: RecentKeyword[]; version?: number }
