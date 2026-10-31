import { inject, injectable } from 'inversify'
import { HTTPException } from 'hono/http-exception'
import { LoginQRCallbackEventType, ZaloApiError, ZaloApiLoginQRAborted, type API, type User } from '@hwqnq/zca-js'
import { broadcast } from '../../../../core'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import type { ChangeAvatarRequest, UpdateProfileRequest } from '../../dtos/requests/account.request'
import type { Account, AccountState, AccountStatus, Profile } from '../../dtos/responses/account.response'
import { TOKENS } from '../../../../di/tokens'
import type IAccountRepository from '../../repositories/interfaces/account-repository'
import type { AccountRow } from '../../repositories/interfaces/account-repository'
import type IAccountService from '../interfaces/account-service'

// business accounts' fields as me-v2 returns them; Zalo PC sends them back on every profile update
type BizInfo = { biz?: { desc?: string; cate?: number; addr?: string; website?: string; email?: string } }

export const retryDelay = (attempt: number) => Math.min(2000 * 2 ** (attempt - 1), 60_000)
// zca's login says "Đăng nhập thất bại" when Zalo turns the cookie down; a network failure surfaces as fetch's own
// error, and Zalo answering with an HTTP error as "Failed to fetch …": those pass
export const lostSession = (e: unknown) => e instanceof ZaloApiError && !e.message.startsWith('Failed to fetch')

const toProfile = (p: User): Profile => ({
  userId: p.userId,
  displayName: p.displayName,
  zaloName: p.zaloName,
  avatar: p.avatar,
  cover: p.cover,
  status: p.status ?? '',
  gender: typeof p.gender === 'number' ? p.gender : null,
  dob: p.dob ?? 0,
  sdob: p.sdob ?? '',
  phoneNumber: p.phoneNumber || null,
})

@injectable()
export default class AccountService implements IAccountService {
  private status = new Map<string, AccountStatus>()
  private abortQR?: () => unknown
  // reconnects waiting to run, with how many tried in a row
  private retries = new Map<string, { attempt: number; timer: ReturnType<typeof setTimeout> }>()
  // logins in flight: a manual "Kết nối lại" and a scheduled retry must not both attach
  private logging = new Set<string>()

  constructor(
    @inject(TOKENS.AccountRepository) private accounts: IAccountRepository,
    @inject(ZcaService) private zca: ZcaService,
  ) {
    zca.on('status', (id, status) => this.setStatus(id, status))
    zca.on('dropped', (id) => this.reconnectLater(id))
    // the socket is up again: the next drop starts over from the shortest wait
    zca.on('ready', (id) => this.cancelRetry(id))
  }

  list(): Account[] {
    return this.accounts.list().map((a) => ({ ...a, status: this.status.get(a.id) ?? 'offline' }))
  }

  // Reconnect every active account from its saved cookie (server start).
  restore() {
    const rows = this.accounts.active()
    return Promise.allSettled(rows.map((row) => this.connect(row)))
  }

  startQR() {
    this.abortQR?.()
    const flow = this.zca.loginQR((e) => {
      switch (e.type) {
        case LoginQRCallbackEventType.QRCodeGenerated:
          this.abortQR = e.actions.abort
          broadcast({ type: 'qr', image: e.data.image })
          break
        case LoginQRCallbackEventType.QRCodeScanned:
          broadcast({ type: 'qr-scanned', name: e.data.display_name, avatar: e.data.avatar })
          break
        case LoginQRCallbackEventType.QRCodeExpired:
        case LoginQRCallbackEventType.QRCodeDeclined:
          e.actions.abort()
          broadcast({ type: 'qr-failed' })
          break
      }
    })
    flow
      .then(async (api) => {
        const id = await this.save(api)
        this.zca.attach(id, api)
        broadcast({ type: 'qr-done', id })
      })
      .catch((e) => {
        if (e instanceof ZaloApiLoginQRAborted) return
        console.error('QR login failed', e)
        broadcast({ type: 'qr-failed' })
      })
  }

  cancelQR() {
    this.abortQR?.()
    this.abortQR = undefined
  }

  setState(id: string, state: AccountState) {
    const row = this.accounts.setState(id, state)
    if (!row) return false
    this.cancelRetry(id)
    if (state !== 'active') this.zca.detach(id)
    else if (!this.zca.has(id)) void this.connect(row)
    return true
  }

  async remove(id: string) {
    this.cancelRetry(id)
    if (this.zca.has(id)) {
      const api = this.zca.get(id)
      // PC deactivates its heartbeat on logout ({status: 0, imei}, as its deactiveV2)
      await api.updateActiveStatus(false).catch(() => {})
      await api.logout().catch((e) => console.error(`[${id}] logout`, e))
    }
    this.zca.detach(id)
    this.status.delete(id)
    return this.accounts.remove(id)
  }

  // ===== Own profile (Zalo PC "Thông tin tài khoản") =====

  // Read from Zalo each time, so edits made on the phone show up; the account row follows name and avatar.
  async profile(id: string) {
    const { profile } = await this.zca.get(id).fetchAccountInfo()
    const changed = this.accounts.setProfile(id, profile.displayName, profile.avatar)
    if (changed) broadcast({ type: 'profile', id, name: profile.displayName, avatar: profile.avatar })
    return toProfile(profile)
  }

  async updateProfile(id: string, { name, gender, dob }: UpdateProfileRequest) {
    const api = this.zca.get(id)
    // without its business fields Zalo would clear a business account's category
    const { biz } = ((await api.fetchAccountInfo()).profile as User & { bizInfo?: BizInfo }).bizInfo ?? {}
    await api.updateProfile({
      profile: { name, gender, dob: dob as `${string}-${string}-${string}` },
      biz: biz && { cate: Number(biz.cate), description: biz.desc, address: biz.addr, website: biz.website, email: biz.email },
    })
    return this.profile(id)
  }

  async updateBio(id: string, status: string) {
    await this.zca.get(id).updateProfileBio(status)
    return this.profile(id)
  }

  async changeAvatar(id: string, { file, width, height }: ChangeAvatarRequest) {
    await this.zca.get(id).changeAccountAvatar({ data: Buffer.from(await file.arrayBuffer()), filename: 'avatar.jpg', metadata: { totalSize: file.size, width, height } })
    return this.profile(id)
  }

  // ponytail: first 50 only; zca's getAvatarList can't send nextPhotoId, so later pages need a zca fix
  async avatars(id: string) {
    const { photos } = await this.zca.get(id).getAvatarList(50, 1)
    return photos.map(({ photoId, thumbnail, url }) => ({ photoId, thumbnail, url }))
  }

  async reuseAvatar(id: string, photoId: string) {
    await this.zca.get(id).reuseAvatar(photoId)
    return this.profile(id)
  }

  async deleteAvatar(id: string, photoId: string) {
    const { errMap } = await this.zca.get(id).deleteAvatar(photoId)
    if (errMap?.[photoId]) throw new HTTPException(502, { message: `Không xóa được ảnh (lỗi ${errMap[photoId].err})` })
  }

  private async connect(row: AccountRow) {
    if (this.logging.has(row.id)) return
    this.logging.add(row.id)
    this.setStatus(row.id, 'connecting')
    try {
      const api = await this.zca.login({ imei: row.imei, cookie: JSON.parse(row.cookie), userAgent: row.userAgent, language: row.language ?? undefined })
      // removed or paused while logging in: don't resurrect it
      if (!this.accounts.isActive(row.id)) return this.setStatus(row.id, 'offline')
      await this.save(api)
      // attaching pulls what was missed meanwhile: getLastMessages, then the offline queues once the socket is up
      this.zca.attach(row.id, api)
    } catch (e) {
      console.error(`[${row.id}] login failed`, e)
      // Zalo refusing the saved session needs a new QR login; anything else (no network yet at start or after a
      // suspend, Zalo unreachable) is tried again
      if (lostSession(e) || !this.accounts.isActive(row.id)) return this.setStatus(row.id, 'offline')
      this.reconnectLater(row.id)
    } finally {
      this.logging.delete(row.id)
    }
  }

  // Zalo PC's socket retries: wait 2s, doubling up to a minute, and keep trying for as long as it takes
  private reconnectLater(id: string) {
    const attempt = (this.retries.get(id)?.attempt ?? 0) + 1
    clearTimeout(this.retries.get(id)?.timer)
    this.setStatus(id, 'connecting')
    const timer = setTimeout(() => {
      // read at fire time: the cookie may have been refreshed, the account paused or removed
      const row = this.accounts.active().find((r) => r.id === id)
      if (row && !this.zca.has(id)) void this.connect(row)
    }, retryDelay(attempt))
    this.retries.set(id, { attempt, timer })
  }

  private cancelRetry(id: string) {
    clearTimeout(this.retries.get(id)?.timer)
    this.retries.delete(id)
  }

  // Login refreshes cookies in the jar, so credentials are re-saved after every login to keep the session rolling.
  private async save(api: API) {
    const ctx = api.getContext()
    const { profile } = await api.fetchAccountInfo()
    const now = Date.now()
    this.accounts.save({
      id: ctx.uid,
      name: profile.displayName,
      avatar: profile.avatar,
      phoneNumber: profile.phoneNumber,
      imei: ctx.imei,
      cookie: JSON.stringify(ctx.cookie.toJSON()?.cookies ?? []),
      userAgent: ctx.userAgent,
      language: ctx.language,
      now,
    })
    return ctx.uid
  }

  private setStatus(id: string, status: AccountStatus) {
    this.status.set(id, status)
    broadcast({ type: 'account', id, status })
  }
}
