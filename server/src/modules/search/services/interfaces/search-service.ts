import type { RecentRequest } from '../../dtos/requests/search.request'
import type { RecentSearch, SearchContact, SearchMessage } from '../../dtos/responses/search.response'

export default interface ISearchService {
  search(accountId: string, q: string, hidden?: Set<string>, unlocked?: boolean): { messages: SearchMessage[]; files: SearchMessage[]; contacts: SearchContact[]; hidden: SearchContact[]; unlocked: boolean }
  recent(accountId: string, hidden?: Set<string>): Promise<RecentSearch>
  addRecent(accountId: string, item: RecentRequest): Promise<void>
  removeRecent(accountId: string, item: RecentRequest): Promise<void>
}
