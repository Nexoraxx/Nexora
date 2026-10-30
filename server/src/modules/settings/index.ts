import { Hono } from 'hono'
import type ISettingsService from './services/interfaces/settings-service'
import { PresenceRequest, UpdateSettingRequest } from './dtos/requests/settings.request'

// Mounted under /accounts/:accountId. Changes from any device go out on /events as "settings".
export const settingsRoutes = (settings: ISettingsService) =>
  new Hono()
    .get('/settings', async (c) => c.json(await settings.get(c.req.param('accountId')!)))
    .patch('/settings', async (c) => {
      const { key, value } = UpdateSettingRequest.parse(await c.req.json())
      return c.json(await settings.update(c.req.param('accountId')!, key, value))
    })
    .put('/presence', async (c) => {
      settings.setForeground(c.req.param('accountId')!, PresenceRequest.parse(await c.req.json()).foreground)
      return c.body(null, 204)
    })
