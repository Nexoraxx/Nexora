import type { ChangeAvatarRequest, UpdateProfileRequest } from '../../dtos/requests/account.request'
import type { Account, AccountState, Profile } from '../../dtos/responses/account.response'

export default interface IAccountService {
  list(): Account[]
  restore(): Promise<PromiseSettledResult<void>[]>
  startQR(): void
  cancelQR(): void
  setState(id: string, state: AccountState): boolean
  remove(id: string): Promise<boolean>
  profile(id: string): Promise<Profile>
  updateProfile(id: string, body: UpdateProfileRequest): Promise<Profile>
  updateBio(id: string, status: string): Promise<Profile>
  changeAvatar(id: string, body: ChangeAvatarRequest): Promise<Profile>
  avatars(id: string): Promise<{ photoId: string; thumbnail: string; url: string }[]>
  reuseAvatar(id: string, photoId: string): Promise<Profile>
  deleteAvatar(id: string, photoId: string): Promise<void>
}
