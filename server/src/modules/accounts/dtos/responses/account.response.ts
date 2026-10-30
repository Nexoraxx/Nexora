import { z } from 'zod'

export const AccountStatus = z.enum(['connecting', 'online', 'offline', 'kicked'])
export type AccountStatus = z.infer<typeof AccountStatus>


export const AccountState = z.enum(['active', 'locked', 'retired'])
export type AccountState = z.infer<typeof AccountState>

export const Account = z.object({ id: z.string(), name: z.string(), avatar: z.string().nullable(), status: AccountStatus, state: AccountState })
export type Account = z.infer<typeof Account>

// Zalo profile as shown in the "Thông tin tài khoản" modal. sdob arrives already filtered by the owner's view_birthday
// privacy (full date, day/month or empty); gender 0 = Nam, 1 = Nữ.
export type Profile = {
  userId: string
  displayName: string
  zaloName: string
  avatar: string
  cover: string
  status: string
  gender: number | null
  dob: number
  sdob: string
  phoneNumber: string | null
}
