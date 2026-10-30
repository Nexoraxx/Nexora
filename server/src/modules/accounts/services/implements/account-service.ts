import { inject, injectable } from 'inversify'
import { HTTPException } from 'hono/http-exception'
import { LoginQRCallbackEventType, ZaloApiLoginQRAborted, type API, type User } from '@hwqnq/zca-js'
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

  constructor(
    @inject(TOKENS.AccountRepository) private accounts: IAccountRepository,
    @inject(ZcaService) private zca: ZcaService,
  ) {
    zca.on('status', (id, status) => this.setStatus(id, status))
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
    if (state !== 'active') this.zca.detach(id)
    else if (!this.zca.has(id)) void this.connect(row)
    return true
  }

  async remove(id: string) {
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
    this.setStatus(row.id, 'connecting')
    try {
      const api = await this.zca.login({ imei: row.imei, cookie: JSON.parse(row.cookie), userAgent: row.userAgent, language: row.language ?? undefined })
      // removed or paused while logging in: don't resurrect it
      if (!this.accounts.isActive(row.id)) return this.setStatus(row.id, 'offline')
      await this.save(api)
      this.zca.attach(row.id, api)
    } catch (e) {
      console.error(`[${row.id}] login failed`, e)
      this.setStatus(row.id, 'offline')
    }
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
