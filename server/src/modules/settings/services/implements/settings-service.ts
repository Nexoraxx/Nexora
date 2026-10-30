import { inject, injectable } from 'inversify'
import type { UpdateSettingsType } from '@hwqnq/zca-js'
import { broadcast } from '../../../../core'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import { controlData } from '../../../../third-party/zalo/controls'
import { zaloGet } from '../../../../third-party/zalo/post'
import type { Settings } from '../../dtos/responses/settings.response'
import type ISettingsService from '../interfaces/settings-service'

// Zalo PC update_action_interval; ping status: 1 foreground, 0 background, 2 / 3 coming to / leaving the foreground
const PING_EVERY = 60_000
const FOREGROUND = 1
const BACKGROUND = 0
const TO_FOREGROUND = 2
const TO_BACKGROUND = 3
// PC reads these snake_case but writes them camelCase (as zca's UpdateSettingsType does)
const WIRE: Record<string, string> = { quick_message_status: 'quickMessageStatus', archived_chat_status: 'archivedChatStatus' }

// The account's own settings (/api/setting/me), kept per session: read once, then followed through this app's
// changes and the my_settings control Zalo sends when they change on another device (zca's listener drops it).
// Also PC's activity heartbeat: /api/social/profile/ping with the app state every minute, which is what others'
// "Vừa truy cập" follows.
@injectable()
export default class SettingsService implements ISettingsService {
  private cache = new Map<string, Promise<Settings>>()
  private foreground = new Map<string, boolean>()
  private timers = new Map<string, ReturnType<typeof setInterval>>()

  constructor(@inject(ZcaService) private zca: ZcaService) {
    zca.on('attached', (id) => {
      this.cache.delete(id)
      clearInterval(this.timers.get(id))
      this.timers.set(id, setInterval(() => void this.ping(id, this.foreground.get(id) ? FOREGROUND : BACKGROUND), PING_EVERY))
    })
    zca.on('status', (id, status) => {
      if (status !== 'offline' && status !== 'kicked') return
      clearInterval(this.timers.get(id))
      this.timers.delete(id)
    })
    zca.on('control', (id, c) => {
      const data = c.act_type === 'my_settings' && c.act === 'update' ? controlData<Record<string, unknown>>(c) : undefined
      if (data && typeof data === 'object') void this.merge(id, data)
    })
  }

  // booleans (show_online_status) come back as 1 / 0
  get(accountId: string) {
    let s = this.cache.get(accountId)
    if (!s) {
      s = this.zca
        .get(accountId)
        .getSettings()
        .then((r) => normalize(r as unknown as Record<string, unknown>))
      this.cache.set(accountId, s)
      s.catch(() => this.cache.delete(accountId))
    }
    return s
  }

  // PC sends one key per change and skips an unchanged one
  async update(accountId: string, key: string, value: number) {
    const current = await this.get(accountId)
    if (current[key] === value) return current
    await this.zca.get(accountId).updateSettings((WIRE[key] ?? key) as UpdateSettingsType, value)
    return this.merge(accountId, { [key]: value })
  }

  // "Hiển thị trạng thái truy cập" of this account; off hides everyone else's too, as on PC
  async showsOnline(accountId: string) {
    return (await this.get(accountId)).show_online_status !== 0
  }

  setForeground(accountId: string, foreground: boolean) {
    if (!!this.foreground.get(accountId) === foreground) return
    this.foreground.set(accountId, foreground)
    void this.ping(accountId, foreground ? TO_FOREGROUND : TO_BACKGROUND)
  }

  private async ping(accountId: string, status: number) {
    if (!this.zca.has(accountId)) return
    const api = this.zca.get(accountId)
    await zaloGet(api, 'profile', '/api/social/profile/ping', { status, imei: api.getContext().imei }).catch((e) => console.error(`[${accountId}] ping`, e))
  }

  private async merge(accountId: string, change: Record<string, unknown>) {
    const next = { ...(await this.get(accountId).catch(() => ({}))), ...normalize(change) }
    this.cache.set(accountId, Promise.resolve(next))
    broadcast({ type: 'settings', accountId })
    return next
  }
}

const normalize = (s: Record<string, unknown>): Settings =>
  Object.fromEntries(Object.entries(s).flatMap(([k, v]) => (typeof v === 'boolean' ? [[k, Number(v)]] : typeof v === 'number' ? [[k, v]] : [])))
