import { inject, injectable } from 'inversify'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import type { RecentRequest } from '../../dtos/requests/search.request'
import { TOKENS } from '../../../../di/tokens'
import type { SearchContact, SearchMessage, RecentSearch } from '../../dtos/responses/search.response'
import type ISearchRepository from '../../repositories/interfaces/search-repository'
import type ISearchService from '../interfaces/search-service'

// Zalo PC's global search caps: results kept per section (the "Tất cả" tab shows 6 contacts, 3 messages, 3 files)
const MAX_CONTACTS = 100
const MAX_MESSAGES = 100
// sync_recent_search: num_item_show 20 contacts / groups, num_item_kw 5 keywords
const MAX_RECENT = 20
const MAX_KEYWORDS = 5
// recentsearch/update errors after which PC reloads the list (version conflict)
const STALE_VERSION = new Set([160, 266])

type RecentItem = { id: string; type: number; last_update_time?: number }
type RecentKeyword = { key: string; last_update_time?: number }
type RecentList = { list_recent?: RecentItem[]; list_keyword?: RecentKeyword[]; version?: number }

// accent-, đ- and case-insensitive, as PC's simpleStripVietnamese
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase()

// PC's contact rule: every keyword (longest first) is the start of a different word of the name
export function nameMatches(names: (string | null | undefined)[], q: string) {
  const keywords = fold(q).split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)
  return (
    keywords.length > 0 &&
    names.some((name) => {
      const words = fold(name ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      const used = new Set<number>()
      return keywords.every((k) => {
        const i = words.findIndex((w, j) => !used.has(j) && w.startsWith(k))
        return i >= 0 && used.add(i)
      })
    })
  )
}

// Zalo PC's search box above the conversation list: contacts and groups by name, messages and files from local
// history (full-text, newest first), and "Tìm gần đây" kept on Zalo (recentsearch/list, update).
@injectable()
export default class SearchService implements ISearchService {
  constructor(
    @inject(TOKENS.SearchRepository) private searchRepo: ISearchRepository,
    @inject(ZcaService) private zca: ZcaService,
  ) {}

  // `hidden`: "Ẩn trò chuyện" threads, left out of every section but "Trò chuyện ẩn": those matching by name, or all
  // of them when the keyword is the PIN (`unlocked`), as PC's search box opens them
  search(accountId: string, q: string, hidden: Set<string> = new Set(), unlocked = false) {
    const all = this.contacts(accountId, unlocked ? null : q)
    return {
      contacts: all.filter((c) => !hidden.has(c.userId)),
      hidden: (unlocked ? all : this.contacts(accountId, q)).filter((c) => hidden.has(c.userId)),
      unlocked,
      ...this.messages(accountId, q, hidden),
    }
  }

  // friends, people chatted with and groups (all of them for a null q); most recent conversation first, then shorter names
  private contacts(accountId: string, q: string | null): SearchContact[] {
    const rows = this.searchRepo.contacts(accountId)
    return rows
      .filter((r) => r.userId !== accountId && (q === null || nameMatches([r.alias, r.displayName, r.zaloName], q)))
      .map((r) => ({ userId: r.userId, isGroup: !!r.isGroup, name: r.alias || r.displayName || r.userId, avatar: r.avatar, isFr: r.isFr === 1, last: r.last ?? 0 }))
      .sort((a, b) => b.last - a.last || a.name.length - b.name.length)
      .slice(0, MAX_CONTACTS)
      .map(({ last: _, ...c }) => c)
  }

  // the words as one phrase with a prefix last word (search V2); files are matched by name
  private messages(accountId: string, q: string, hidden: Set<string>) {
    const words = q.replace(/[đĐ]/g, 'd').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (!words) return { messages: [], files: [] }
    const find = (files: boolean) =>
      this.searchRepo
        .messages(accountId, words, files, MAX_MESSAGES)
        .filter((r) => !hidden.has(r.threadId))
        .map(({ message, isGroup, ...r }): SearchMessage => ({ ...r, isGroup: !!isGroup, content: message == null ? null : JSON.parse(message) }))
    return { messages: find(false), files: find(true) }
  }

  // "Tìm gần đây": opened contacts / groups, then keywords; names from local contacts
  async recent(accountId: string, hidden: Set<string> = new Set()): Promise<RecentSearch> {
    const list = await this.fetchRecent(accountId)
    const contacts = (list.list_recent ?? [])
      .filter((i) => i.type === 0 || i.type === 1)
      .map((i) => this.contact(accountId, String(i.id), i.type === 1))
      .filter((c): c is SearchContact => !!c && !hidden.has(c.userId))
    return { contacts: contacts.slice(0, MAX_RECENT), keywords: (list.list_keyword ?? []).map((k) => k.key).slice(0, MAX_KEYWORDS) }
  }

  // PC adds a contact when it's opened from the results, a keyword when a found message / file is opened
  async addRecent(accountId: string, item: RecentRequest) {
    await this.updateRecent(accountId, (list) => {
      const now = Date.now()
      if (item.kind === 'keyword')
        list.list_keyword = [{ key: item.key, last_update_time: now }, ...(list.list_keyword ?? []).filter((k) => k.key !== item.key)].slice(0, MAX_KEYWORDS)
      else list.list_recent = [{ id: item.id, type: item.isGroup ? 1 : 0, last_update_time: now }, ...(list.list_recent ?? []).filter((r) => String(r.id) !== item.id)].slice(0, MAX_RECENT)
    })
  }

  async removeRecent(accountId: string, item: RecentRequest) {
    await this.updateRecent(accountId, (list) => {
      if (item.kind === 'keyword') list.list_keyword = (list.list_keyword ?? []).filter((k) => k.key !== item.key)
      else list.list_recent = (list.list_recent ?? []).filter((r) => String(r.id) !== item.id)
    })
  }

  // PC sends the whole list with its version; on a version conflict it reloads and tries again
  private async updateRecent(accountId: string, change: (list: RecentList) => void, retry = true): Promise<void> {
    const list = await this.fetchRecent(accountId)
    change(list)
    try {
      // zca types keywords as strings; PC sends { key, last_update_time }
      await this.zca.get(accountId).updateRecentSearch(list.list_recent ?? [], list.version ?? 0, (list.list_keyword ?? []) as unknown as string[])
    } catch (e) {
      if (!retry || !STALE_VERSION.has(Number((e as { code?: number }).code))) throw e
      return this.updateRecent(accountId, change, false)
    }
  }

  private async fetchRecent(accountId: string): Promise<RecentList> {
    const r = (await this.zca.get(accountId).getRecentSearch()) as RecentList
    // ids come bare; PC prefixes "g" for groups (type 1) only locally
    return { list_recent: (r?.list_recent ?? []).map((i) => ({ ...i, id: String(i.id) })), list_keyword: r?.list_keyword ?? [], version: r?.version ?? 0 }
  }

  private contact(accountId: string, id: string, isGroup: boolean): SearchContact | null {
    if (isGroup) {
      const r = this.searchRepo.group(accountId, id)
      return r && { userId: id, isGroup: true, name: r.displayName ?? id, avatar: r.avatar, isFr: false }
    }
    const r = this.searchRepo.user(accountId, id)
    return r && { userId: id, isGroup: false, name: r.name ?? id, avatar: r.avatar, isFr: r.isFr === 1 }
  }
}
