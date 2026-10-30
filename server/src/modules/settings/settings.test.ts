import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { ZcaService } from '../../third-party/zalo/zalo-client'
import SettingsService from './services/implements/settings-service'

test('privacy settings: read once, one key per change, unchanged skipped, my_settings from other devices merged', async () => {
  const getSettings = mock(async () => ({ show_online_status: true, view_birthday: 1, receive_message: 1 }))
  const updateSettings = mock(async () => '')
  const nexoraGet = mock(async () => '')
  const api = { getSettings, updateSettings, nexoraGet, zpwServiceMap: { profile: ['https://profile'] }, getContext: () => ({ imei: 'imei' }) }
  const zca = Object.assign(new EventEmitter(), { get: () => api, has: () => true }) as unknown as ZcaService
  const settings = new SettingsService(zca)

  expect(await settings.get('me')).toEqual({ show_online_status: 1, view_birthday: 1, receive_message: 1 })
  expect(await settings.update('me', 'view_birthday', 2)).toMatchObject({ view_birthday: 2 })
  await settings.update('me', 'view_birthday', 2)
  expect(updateSettings.mock.calls as unknown[]).toEqual([['view_birthday', 2]])
  expect(getSettings).toHaveBeenCalledTimes(1)

  zca.emit('control', 'me', { act_type: 'my_settings', act: 'update', data: '{"show_online_status":false}' })
  await Bun.sleep(0)
  expect(await settings.showsOnline('me')).toBe(false)

  // heartbeat: 2 coming to the foreground, 3 leaving it, nothing when unchanged
  settings.setForeground('me', true)
  settings.setForeground('me', true)
  settings.setForeground('me', false)
  await Bun.sleep(0)
  expect(nexoraGet.mock.calls.map((c) => (c as unknown as [{ url: string; params: { status: number } }])[0])).toEqual([
    { url: 'https://profile/api/social/profile/ping', params: { status: 2, imei: 'imei' } },
    { url: 'https://profile/api/social/profile/ping', params: { status: 3, imei: 'imei' } },
  ] as never)
})
