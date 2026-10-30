import type { SearchMessage } from '../../dtos/responses/search.response'

export type ContactRow = { userId: string; isGroup: number; alias: string | null; displayName: string | null; zaloName: string | null; avatar: string | null; isFr: number; last: number | null }
export type MessageHit = Omit<SearchMessage, 'isGroup' | 'content'> & { isGroup: number | null; message: string | null }

export default interface ISearchRepository {
  // friends, people chatted with and groups, with the time of their last message
  contacts(accountId: string): ContactRow[]
  // newest first; `words` is matched as one phrase with a prefix last word
  messages(accountId: string, words: string, files: boolean, limit: number): MessageHit[]
  group(accountId: string, id: string): { displayName: string | null; avatar: string | null } | null
  user(accountId: string, id: string): { name: string | null; avatar: string | null; isFr: number } | null
}
