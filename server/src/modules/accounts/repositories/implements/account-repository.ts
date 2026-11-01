import { inject, injectable } from 'inversify'
import { Database } from '../../../../dbs/sqlite'
import { TOKENS } from '../../../../di/tokens'
import type { Account, AccountState } from '../../dtos/responses/account.response'
import type IAccountRepository from '../interfaces/account-repository'
import type { AccountRow, SavedAccount } from '../../models/account.model'

@injectable()
export default class AccountRepository implements IAccountRepository {
  constructor(@inject(TOKENS.Database) private db: Database) {}

  list() {
    return this.db.query<Omit<Account, 'status'>, []>(`SELECT id, name, avatar, state FROM account ORDER BY createdAt`).all()
  }

  active() {
    return this.db.query<AccountRow, []>(`SELECT * FROM account WHERE state = 'active'`).all()
  }

  isActive(id: string) {
    return !!this.db.query(`SELECT 1 FROM account WHERE id = ? AND state = 'active'`).get(id)
  }

  setState(id: string, state: AccountState) {
    return this.db.query<AccountRow, [string, string]>(`UPDATE account SET state = ? WHERE id = ? RETURNING *`).get(state, id)
  }

  remove(id: string) {
    return this.db.run(`DELETE FROM account WHERE id = ?`, [id]).changes > 0
  }

  setProfile(id: string, name: string, avatar: string) {
    return this.db.run(`UPDATE account SET name = ?, avatar = ? WHERE id = ? AND (name IS NOT ? OR avatar IS NOT ?)`, [name, avatar, id, name, avatar]).changes
  }

  save(account: SavedAccount) {
    this.db.query(
      `INSERT INTO account (id, name, avatar, phoneNumber, imei, cookie, userAgent, language, state, createdAt, lastLoginAt)
       VALUES ($id, $name, $avatar, $phoneNumber, $imei, $cookie, $userAgent, $language, 'active', $now, $now)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, phoneNumber = excluded.phoneNumber,
         imei = excluded.imei, cookie = excluded.cookie, userAgent = excluded.userAgent, language = excluded.language,
         state = 'active', lastLoginAt = excluded.lastLoginAt`,
    ).run(account)
  }
}
