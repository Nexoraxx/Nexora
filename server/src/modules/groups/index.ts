import { Hono } from 'hono'
import type IGroupService from './services/interfaces/group-service'
import { ChangeAvatarRequest } from '../accounts/dtos/requests/account.request'
import {
  CreateGroupRequest,
  DeclineInvitationRequest,
  GroupSettingsRequest,
  InviteToGroupsRequest,
  LeaveGroupRequest,
  LinkRequest,
  MembersRequest,
  OwnerRequest,
  ReviewRequest,
} from './dtos/requests/group.request'

// Mounted under /accounts/:accountId, next to the group reads in contacts. Changes go out on /events as
// "contacts", "threads" and "group".
export const groupRoutes = (groups: IGroupService) =>
  new Hono()
    .post('/groups', async (c) => c.json(await groups.create(c.req.param('accountId')!, CreateGroupRequest.parse(await c.req.json()))))
    .delete('/groups/:groupId', async (c) => {
      await groups.disperse(c.req.param('accountId')!, c.req.param('groupId'))
      return c.body(null, 204)
    })
    .post('/groups/:groupId/members', async (c) =>
      c.json(await groups.addMembers(c.req.param('accountId')!, c.req.param('groupId'), MembersRequest.parse(await c.req.json()).userIds)),
    )
    .post('/users/:userId/groups', async (c) =>
      c.json(await groups.inviteToGroups(c.req.param('accountId')!, c.req.param('userId'), InviteToGroupsRequest.parse(await c.req.json()).groupIds)),
    )
    .delete('/groups/:groupId/members/:userId', async (c) => {
      await groups.removeMember(c.req.param('accountId')!, c.req.param('groupId'), c.req.param('userId'))
      return c.body(null, 204)
    })
    .post('/groups/:groupId/leave', async (c) => {
      await groups.leave(c.req.param('accountId')!, c.req.param('groupId'), LeaveGroupRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .put('/groups/:groupId/owner', async (c) => {
      await groups.changeOwner(c.req.param('accountId')!, c.req.param('groupId'), OwnerRequest.parse(await c.req.json()).userId)
      return c.body(null, 204)
    })
    .put('/groups/:groupId/admins/:userId', async (c) => {
      await groups.setDeputy(c.req.param('accountId')!, c.req.param('groupId'), c.req.param('userId'), true)
      return c.body(null, 204)
    })
    .delete('/groups/:groupId/admins/:userId', async (c) => {
      await groups.setDeputy(c.req.param('accountId')!, c.req.param('groupId'), c.req.param('userId'), false)
      return c.body(null, 204)
    })
    .get('/groups/:groupId/blocked', async (c) => c.json(await groups.blocked(c.req.param('accountId')!, c.req.param('groupId'))))
    .put('/groups/:groupId/blocked/:userId', async (c) => {
      await groups.setBlocked(c.req.param('accountId')!, c.req.param('groupId'), c.req.param('userId'), true)
      return c.body(null, 204)
    })
    .delete('/groups/:groupId/blocked/:userId', async (c) => {
      await groups.setBlocked(c.req.param('accountId')!, c.req.param('groupId'), c.req.param('userId'), false)
      return c.body(null, 204)
    })
    .get('/groups/:groupId/pending', async (c) => c.json(await groups.pending(c.req.param('accountId')!, c.req.param('groupId'))))
    .post('/groups/:groupId/pending', async (c) => {
      const { userIds, approve } = ReviewRequest.parse(await c.req.json())
      return c.json(await groups.review(c.req.param('accountId')!, c.req.param('groupId'), userIds, approve))
    })
    .get('/groups/:groupId/link', async (c) => c.json(await groups.link(c.req.param('accountId')!, c.req.param('groupId'))))
    .post('/groups/:groupId/link', async (c) => c.json(await groups.renewLink(c.req.param('accountId')!, c.req.param('groupId'))))
    .delete('/groups/:groupId/link', async (c) => {
      await groups.disableLink(c.req.param('accountId')!, c.req.param('groupId'))
      return c.body(null, 204)
    })
    .put('/groups/:groupId/avatar', async (c) => {
      await groups.changeAvatar(c.req.param('accountId')!, c.req.param('groupId'), ChangeAvatarRequest.parse(await c.req.parseBody()))
      return c.body(null, 204)
    })
    .put('/groups/:groupId/settings', async (c) => {
      await groups.updateSettings(c.req.param('accountId')!, c.req.param('groupId'), GroupSettingsRequest.parse(await c.req.json()))
      return c.body(null, 204)
    })
    .get('/group-links', async (c) => c.json(await groups.linkInfo(c.req.param('accountId')!, LinkRequest.parse(c.req.query()).link)))
    .post('/group-links/join', async (c) => c.json(await groups.joinLink(c.req.param('accountId')!, LinkRequest.parse(await c.req.json()).link)))
    .get('/group-invitations', async (c) => c.json(await groups.invitations(c.req.param('accountId')!)))
    .post('/group-invitations/:groupId/join', async (c) => {
      await groups.joinInvitation(c.req.param('accountId')!, c.req.param('groupId'))
      return c.body(null, 204)
    })
    .delete('/group-invitations/:groupId', async (c) => {
      await groups.declineInvitation(c.req.param('accountId')!, c.req.param('groupId'), DeclineInvitationRequest.parse(c.req.query()).block)
      return c.body(null, 204)
    })
