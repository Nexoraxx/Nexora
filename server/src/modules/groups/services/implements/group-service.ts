import { inject, injectable } from 'inversify'
import { HTTPException } from 'hono/http-exception'
import { ZaloApiError } from '@hwqnq/zca-js'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import { nextClientId, zaloGet, zaloPost } from '../../../../third-party/zalo/post'
import type { GroupLink, PendingMember, BlockedMember, LinkGroup, GroupInvitation } from '../../dtos/responses/group.response'
import type IContactService from '../../../contacts/services/interfaces/contact-service'
import type IMessageService from '../../../messages/services/interfaces/message-service'
import type { ChangeAvatarRequest } from '../../../accounts/dtos/requests/account.request'
import type { CreateGroupRequest, GroupSettingsRequest, LeaveGroupRequest } from '../../dtos/requests/group.request'
import { TOKENS } from '../../../../di/tokens'
import type IGroupRepository from '../../repositories/interfaces/group-repository'
import type IGroupService from '../interfaces/group-service'
import { MAX_NAME, NORMAL, FRIEND, FROM_PROFILE, GROUP_ERRORS, CREATE_ERRORS, JOIN_ERRORS, REVIEW_ERRORS } from '../../constants/group.constant'
import { inviteError, multiInviteError } from '../../helpers/group.helper'
import { explain } from '../../../../core/extensions/exceptions'

// Zalo PC's group management: create, members, owner and deputies, blocks, approvals, join link, invitations,
// avatar and settings. Every change refetches the group, so the members panel and lists follow at once (the group
// event from Zalo refetches it again); leaving or dispersing drops the group and its conversation, as PC does.
@injectable()
export default class GroupService implements IGroupService {
  constructor(
    @inject(TOKENS.GroupRepository) private groups: IGroupRepository,
    @inject(ZcaService) private zca: ZcaService,
    @inject(TOKENS.ContactService) private contacts: IContactService,
    @inject(TOKENS.MessageService) private messages: IMessageService,
  ) {}

  // PC sends createGroupV2 as a GET with memberTypes and groupType (zca misspells membersTypes)
  async create(accountId: string, { name, members }: CreateGroupRequest) {
    const api = this.zca.get(accountId)
    const { imei, language } = api.getContext()
    const typed = name.trim()
    let gname = (typed || this.names(accountId, members, 'zaloName').join(', ') || 'Nhóm mới').replace(/[~`!@#$%^&*]/g, '').trim()
    if (!typed && gname.length > MAX_NAME) gname = `${gname.slice(0, MAX_NAME)}....`
    const r = await zaloGet<{ groupId: string }>(api, 'group', '/api/group/create/v2', {
      clientId: nextClientId(),
      gname,
      gdesc: null,
      members,
      memberTypes: members.map(() => FRIEND),
      nameChanged: typed ? 1 : 0,
      createLink: 1,
      clientLang: language,
      imei,
      groupType: NORMAL,
    }).catch(explain(CREATE_ERRORS))
    const groupId = String(r.groupId)
    await this.contacts.refreshGroup(accountId, groupId)
    return { groupId, name: gname }
  }

  // "Thêm thành viên": returns PC's lines for whoever couldn't be added
  async addMembers(accountId: string, groupId: string, userIds: string[]) {
    const r = await this.zca.get(accountId).addUserToGroup(userIds, groupId).catch(explain(GROUP_ERRORS))
    await this.contacts.refreshGroup(accountId, groupId)
    const errors = Object.entries(r.error_data ?? {}).map(([code, ids]) => inviteError(Number(code), this.names(accountId, ids)))
    return { errors: errors.filter(Boolean) }
  }

  // "Thêm vào nhóm" from a friend's profile: one friend into several groups at once through invite/multi, a GET as
  // PC sends it (not invite/v2 of "Thêm thành viên"). Returns PC's line for each group that didn't take them; the
  // groups themselves follow through Zalo's group events.
  async inviteToGroups(accountId: string, userId: string, groupIds: string[]) {
    const api = this.zca.get(accountId)
    const r = await zaloGet<{ grid_error_map?: Record<string, number | string> }>(api, 'group', '/api/group/invite/multi', {
      grids: groupIds,
      member: userId,
      memberType: FRIEND,
      srcInteraction: FROM_PROFILE,
      clientLang: api.getContext().language,
    }).catch((e) => {
      throw e instanceof ZaloApiError ? new HTTPException(400, { message: 'Mời vào nhóm bị lỗi' }) : e
    })
    const [name] = this.names(accountId, [userId])
    const failed = Object.entries(r.grid_error_map ?? {}).filter(([, code]) => Number(code) !== 0 && Number(code) !== 178)
    const groups = new Map(this.groups.groupNames(accountId).map((g) => [g.userId, g.displayName]))
    return { errors: failed.map(([groupId, code]) => `${groups.get(groupId) ?? groupId}: ${multiInviteError(Number(code), name)}`) }
  }

  async removeMember(accountId: string, groupId: string, userId: string) {
    await this.zca.get(accountId).removeUserFromGroup(userId, groupId).catch(explain(GROUP_ERRORS))
    await this.contacts.refreshGroup(accountId, groupId)
  }

  async leave(accountId: string, groupId: string, { silent, newOwnerId }: LeaveGroupRequest) {
    if (newOwnerId) await this.changeOwner(accountId, groupId, newOwnerId)
    await this.zca.get(accountId).leaveGroup(groupId, silent).catch(explain(GROUP_ERRORS))
    this.messages.leftGroup(accountId, groupId)
  }

  // "Giải tán nhóm": owner only
  async disperse(accountId: string, groupId: string) {
    await this.zca.get(accountId).disperseGroup(groupId).catch(explain(GROUP_ERRORS))
    this.messages.leftGroup(accountId, groupId)
  }

  // "Chuyển quyền trưởng nhóm": PC POSTs it (zca GETs)
  async changeOwner(accountId: string, groupId: string, userId: string) {
    const api = this.zca.get(accountId)
    const { imei, language } = api.getContext()
    await zaloPost(api, 'group', '/api/group/change-owner', { grid: groupId, newAdminId: userId, imei, language }).catch(explain(GROUP_ERRORS))
    await this.contacts.refreshGroup(accountId, groupId)
  }

  async setDeputy(accountId: string, groupId: string, userId: string, deputy: boolean) {
    const api = this.zca.get(accountId)
    await (deputy ? api.addGroupDeputy(userId, groupId) : api.removeGroupDeputy(userId, groupId)).catch(explain(GROUP_ERRORS))
    await this.contacts.refreshGroup(accountId, groupId)
  }

  // "Chặn khỏi nhóm" also takes them out of the group; they can't rejoin until unblocked or added back
  async setBlocked(accountId: string, groupId: string, userId: string, blocked: boolean) {
    const api = this.zca.get(accountId)
    await (blocked ? api.addGroupBlockedMember(userId, groupId) : api.removeGroupBlockedMember(userId, groupId)).catch(explain(GROUP_ERRORS))
    await this.contacts.refreshGroup(accountId, groupId)
  }

  // ponytail: first 50, as PC's first page; page on has_more if big groups need it
  async blocked(accountId: string, groupId: string): Promise<BlockedMember[]> {
    const r = await this.zca.get(accountId).getGroupBlockedMember({ page: 1, count: 50 }, groupId).catch(explain(GROUP_ERRORS))
    return (r.blocked_members ?? []).map((m) => ({ userId: m.id, name: m.dName || m.zaloName, avatar: m.avatar }))
  }

  async pending(accountId: string, groupId: string): Promise<PendingMember[]> {
    const r = await this.zca.get(accountId).getPendingGroupMembers(groupId).catch(explain(GROUP_ERRORS))
    return (r.users ?? []).map((u) => ({ userId: u.uid, name: u.dpn, avatar: u.avatar }))
  }

  // "Duyệt" / "Từ chối"; returns PC's text for each request that failed
  async review(accountId: string, groupId: string, userIds: string[], approve: boolean) {
    const r = await this.zca.get(accountId).reviewPendingMemberRequest({ members: userIds, isApprove: approve }, groupId).catch(explain(REVIEW_ERRORS))
    await this.contacts.refreshGroup(accountId, groupId)
    const failed = Object.values(r ?? {}).filter((code) => Number(code) !== 0)
    return { errors: [...new Set(failed.map((code) => REVIEW_ERRORS[Number(code)] ?? 'Có lỗi xảy ra. Vui lòng thử lại.'))] }
  }

  async link(accountId: string, groupId: string): Promise<GroupLink> {
    const r = await this.zca.get(accountId).getGroupLinkDetail(groupId).catch(explain(GROUP_ERRORS))
    return { link: r.link || null, enabled: !!r.enabled, expiration: r.expiration_date || null }
  }

  // turns the link on, or swaps it for a new one ("Đổi link")
  async renewLink(accountId: string, groupId: string): Promise<GroupLink> {
    const r = await this.zca.get(accountId).enableGroupLink(groupId).catch(explain(GROUP_ERRORS))
    return { link: r.link || null, enabled: !!r.enabled, expiration: r.expiration_date || null }
  }

  async disableLink(accountId: string, groupId: string) {
    await this.zca.get(accountId).disableGroupLink(groupId).catch(explain(GROUP_ERRORS))
  }

  // the group behind a zalo.me/g/... link, before joining
  async linkInfo(accountId: string, link: string): Promise<LinkGroup> {
    const g = await this.zca.get(accountId).getGroupLinkInfo({ link }).catch(explain(JOIN_ERRORS))
    const isMember = this.groups.hasGroup(accountId, g.groupId)
    return { groupId: g.groupId, name: g.name, avatar: g.avt, desc: g.desc ?? '', totalMember: g.totalMember, isMember }
  }

  async joinLink(accountId: string, link: string) {
    const api = this.zca.get(accountId)
    const { groupId } = await api.getGroupLinkInfo({ link }).catch(explain(JOIN_ERRORS))
    await api.joinGroupLink(link).catch(explain(JOIN_ERRORS))
    await this.contacts.refreshGroup(accountId, groupId)
    return { groupId }
  }

  // ponytail: first page (12, PC's own page size is 10); page on hasMore if someone collects that many
  async invitations(accountId: string): Promise<GroupInvitation[]> {
    const r = await this.zca.get(accountId).getGroupInviteBoxList({ page: 0, invPerPage: 12, mcount: 10 })
    return (r.invitations ?? []).map((i) => ({
      groupId: i.groupInfo.groupId,
      name: i.groupInfo.name,
      avatar: i.groupInfo.avt,
      totalMember: i.groupInfo.totalMember,
      inviterName: i.inviterInfo?.dName || i.inviterInfo?.zaloName || '',
      inviterAvatar: i.inviterInfo?.avatar ?? '',
      expiredTs: Number(i.expiredTs),
    }))
  }

  async joinInvitation(accountId: string, groupId: string) {
    await this.zca.get(accountId).joinGroupInviteBox(groupId).catch(explain(JOIN_ERRORS))
    await this.contacts.refreshGroup(accountId, groupId)
  }

  // "Từ chối lời mời vào nhóm?"; block = "Chặn tất cả lời mời tham gia nhóm này"
  async declineInvitation(accountId: string, groupId: string, block: boolean) {
    await this.zca.get(accountId).deleteGroupInviteBox(groupId, block)
  }

  async changeAvatar(accountId: string, groupId: string, { file, width, height }: ChangeAvatarRequest) {
    await this.zca
      .get(accountId)
      .changeGroupAvatar({ data: Buffer.from(await file.arrayBuffer()), filename: 'avatar.jpg', metadata: { totalSize: file.size, width, height } }, groupId)
      .catch(explain(GROUP_ERRORS))
    await this.contacts.refreshGroup(accountId, groupId)
  }

  // PC sends its whole current setting with the switch flipped (zca would turn every flag it isn't given off)
  async updateSettings(accountId: string, groupId: string, change: GroupSettingsRequest) {
    const api = this.zca.get(accountId)
    const row = this.groups.setting(accountId, groupId)
    const setting = row?.setting ? (JSON.parse(row.setting) as Record<string, unknown>) : {}
    await zaloGet(api, 'group', '/api/group/setting/update', { ...setting, ...change, blocked_members: [], grid: groupId, imei: api.getContext().imei }).catch(explain(GROUP_ERRORS))
    await this.contacts.refreshGroup(accountId, groupId)
  }

  // local names (alias first) in the given order, the id when unknown
  private names(accountId: string, userIds: string[], prefer: 'alias' | 'zaloName' = 'alias') {
    const rows = this.groups.userNames(accountId, userIds, prefer)
    const byId = new Map(rows.map((r) => [r.userId, r.name]))
    return userIds.map((id) => byId.get(id) || id)
  }
}
