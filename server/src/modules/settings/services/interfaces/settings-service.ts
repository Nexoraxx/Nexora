import type { Settings } from '../../dtos/responses/settings.response'

export default interface ISettingsService {
  get(accountId: string): Promise<Settings>
  update(accountId: string, key: string, value: number): Promise<Settings>
  showsOnline(accountId: string): Promise<boolean>
  setForeground(accountId: string, foreground: boolean): void
}
