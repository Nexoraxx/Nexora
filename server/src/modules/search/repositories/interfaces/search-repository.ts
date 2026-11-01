import type { ContactRow, MessageHit } from '../../models/search.model'

export default interface ISearchRepository {
  // friends, people chatted with and groups, with the time of their last message
  contacts(accountId: string): ContactRow[]
  // newest first; `words` is matched as one phrase with a prefix last word
  messages(accountId: string, words: string, files: boolean, limit: number): MessageHit[]
  group(accountId: string, id: string): { displayName: string | null; avatar: string | null } | null
  user(accountId: string, id: string): { name: string | null; avatar: string | null; isFr: number } | null
}
