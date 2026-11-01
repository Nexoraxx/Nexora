import { Hono } from 'hono'
import type IAccountService from './services/interfaces/account-service'
import { ChangeAvatarRequest, ReuseAvatarRequest, UpdateAccountStateRequest, UpdateBioRequest, UpdateProfileRequest } from './dtos/requests/account.request'
import { notFound } from './helpers/account.helper'

export const accountRoutes = (accounts: IAccountService) =>
  new Hono()
    .get('/', (c) => c.json(accounts.list()))
    // QR progress is pushed over /events: qr → qr-scanned → qr-done | qr-failed
    .post('/qr', (c) => {
      accounts.startQR()
      return c.body(null, 202)
    })
    .delete('/qr', (c) => {
      accounts.cancelQR()
      return c.body(null, 204)
    })
    .patch('/:id', async (c) => {
      const { state } = UpdateAccountStateRequest.parse(await c.req.json())
      if (!accounts.setState(c.req.param('id'), state)) throw notFound()
      return c.body(null, 204)
    })
    .delete('/:id', async (c) => {
      if (!(await accounts.remove(c.req.param('id')))) throw notFound()
      return c.body(null, 204)
    })
    // own Zalo profile; name/avatar changes also go out on /events as "profile"
    .get('/:id/profile', async (c) => c.json(await accounts.profile(c.req.param('id'))))
    .patch('/:id/profile', async (c) => c.json(await accounts.updateProfile(c.req.param('id'), UpdateProfileRequest.parse(await c.req.json()))))
    .put('/:id/profile/bio', async (c) => c.json(await accounts.updateBio(c.req.param('id'), UpdateBioRequest.parse(await c.req.json()).status)))
    .post('/:id/profile/avatar', async (c) => c.json(await accounts.changeAvatar(c.req.param('id'), ChangeAvatarRequest.parse(await c.req.parseBody()))))
    .put('/:id/profile/avatar', async (c) => c.json(await accounts.reuseAvatar(c.req.param('id'), ReuseAvatarRequest.parse(await c.req.json()).photoId)))
    .get('/:id/profile/avatars', async (c) => c.json(await accounts.avatars(c.req.param('id'))))
    .delete('/:id/profile/avatars/:photoId', async (c) => {
      await accounts.deleteAvatar(c.req.param('id'), c.req.param('photoId'))
      return c.body(null, 204)
    })
