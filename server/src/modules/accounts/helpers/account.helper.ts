import { HTTPException } from 'hono/http-exception'
import { ZaloApiError, type User } from '@hwqnq/zca-js'
import type { Profile } from '../dtos/responses/account.response'

export const notFound = () => new HTTPException(404, { message: 'Không tìm thấy tài khoản' })

export const retryDelay = (attempt: number) => Math.min(2000 * 2 ** (attempt - 1), 60_000)
// zca's login says "Đăng nhập thất bại" when Zalo turns the cookie down; a network failure surfaces as fetch's own
// error, and Zalo answering with an HTTP error as "Failed to fetch …": those pass
export const lostSession = (e: unknown) => e instanceof ZaloApiError && !e.message.startsWith('Failed to fetch')

export const toProfile = (p: User): Profile => ({
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
