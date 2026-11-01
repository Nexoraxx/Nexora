import type { GroupInfoResponse } from '@hwqnq/zca-js'
import type { Profile } from '../../accounts/dtos/responses/account.response'

export type GroupInfo = GroupInfoResponse['gridInfoMap'][string]
export type ProfileRow = Omit<Profile, 'dob'> & { alias: string | null; isFr: number; isBlocked: number | null; friendRequestType: number | null }
export type BlockedProfile = { userId: string; displayName?: string; zaloName?: string; avatar?: string }
