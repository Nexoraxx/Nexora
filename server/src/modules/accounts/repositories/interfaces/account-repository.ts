import type { Account, AccountState } from '../../dtos/responses/account.response'
import type { AccountRow, SavedAccount } from '../../models/account.model'

export default interface IAccountRepository {
  list(): Omit<Account, 'status'>[]
  active(): AccountRow[]
  isActive(id: string): boolean
  setState(id: string, state: AccountState): AccountRow | null
  remove(id: string): boolean
  // number of rows changed: 0 when Zalo's name and avatar are already stored
  setProfile(id: string, name: string, avatar: string): number
  save(account: SavedAccount): void
}
