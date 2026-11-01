import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { ZaloApiError } from '@hwqnq/zca-js'
import type { ZcaService } from '../../third-party/zalo/zalo-client'
import type IAccountRepository from './repositories/interfaces/account-repository'
import AccountService from './services/implements/account-service'
import { lostSession, retryDelay } from './helpers/account.helper'

afterEach(() => mock.restore())

test('reconnect waits 2s doubling up to a minute; only a refused cookie counts as a lost session', () => {
  expect([1, 2, 3, 6, 7, 50].map(retryDelay)).toEqual([2000, 4000, 8000, 60000, 60000, 60000])
  expect(lostSession(new ZaloApiError('Đăng nhập thất bại'))).toBe(true)
  expect(lostSession(new ZaloApiError('Failed to fetch login info: Bad Gateway'))).toBe(false)
  expect(lostSession(new TypeError('fetch failed'))).toBe(false)
})

test('a dropped socket logs in again until it works; a refused session stays offline', async () => {
  // timers run when the test says so
  const timers: { fn: () => void; ms: number }[] = []
  spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms: number) => (timers.push({ fn, ms }), timers.length)) as never)
  const fire = async () => (timers.shift()!.fn(), await Bun.sleep(0))

  const row = { id: 'me', name: 'Me', avatar: '', phoneNumber: '', state: 'active', imei: 'i', cookie: '[]', userAgent: 'ua', language: 'vi' }
  const accounts = { active: () => [row], isActive: () => true, save: mock(() => {}) } as unknown as IAccountRepository
  const api = { getContext: () => ({ uid: 'me', imei: 'i', cookie: { toJSON: () => ({ cookies: [] }) }, userAgent: 'ua', language: 'vi' }), fetchAccountInfo: async () => ({ profile: { displayName: 'Me', avatar: '' } }) }
  const login = mock(async () => api)
  const attach = mock(() => {})
  const sessions = new Set<string>()
  const zca = Object.assign(new EventEmitter(), { login, attach, has: (id: string) => sessions.has(id) }) as unknown as ZcaService
  const service = new AccountService(accounts, zca)
  const status = () => (service as unknown as { status: Map<string, string> }).status.get('me')

  // the socket closes for good (1006 after a suspend): connecting, then a login after 2s
  zca.emit('dropped', 'me')
  expect(status()).toBe('connecting')
  expect(timers.map((t) => t.ms)).toEqual([2000])

  // no network yet: tried again after 4s
  login.mockImplementationOnce(async () => Promise.reject(new TypeError('fetch failed')))
  await fire()
  expect(login).toHaveBeenCalledTimes(1)
  expect(timers.map((t) => t.ms)).toEqual([4000])

  // back online: attached, and the socket coming up resets the wait
  await fire()
  expect(attach).toHaveBeenCalledTimes(1)
  zca.emit('ready', 'me')
  zca.emit('dropped', 'me')
  expect(timers.map((t) => t.ms)).toEqual([2000])

  // Zalo refuses the saved cookie: offline, nothing scheduled (a new QR login is needed)
  login.mockImplementationOnce(async () => Promise.reject(new ZaloApiError('Đăng nhập thất bại')))
  await fire()
  expect(status()).toBe('offline')
  expect(timers).toEqual([])
})
