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

// Zalo PC group_config.max_group_name_length; groupType 1 = NORMAL (2 = community); memberType -1 = friend
const MAX_NAME = 50
const NORMAL = 1
const FRIEND = -1
// PC's MULTI_GROUP_INTERACTION_SRC.PROFILE
const FROM_PROFILE = 0

const NO_PERMISSION = 'Chỉ có trưởng/phó nhóm thực hiện được tính năng này.'
// PC's STR_ERROR_CODE_* for any group call
const GROUP_ERRORS: Record<number, string> = { 161: 'Nhóm không tồn tại', 164: 'Bạn không còn là thành viên trong nhóm này', 165: 'Nhóm không có thành viên', 166: NO_PERMISSION }
const CREATE_ERRORS: Record<number, string> = {
  160: 'Tên nhóm không hợp lệ',
  173: 'Có vài người đã vượt quá số nhóm cho phép, không đủ số người để tạo nhóm (tối thiểu là 3)',
  175: 'Tất cả những người này đã block bạn',
  177: 'Bạn đã vượt quá số nhóm cho phép',
  181: 'Có vài người đã block bạn, không đủ số người để tạo nhóm (tối thiểu là 3)',
  250: 'Tên nhóm không hợp lệ',
  254: 'Bạn không có quyền tạo nhóm vào lúc này',
  270: 'Bạn đã đạt giới hạn tạo nhóm trong ngày.',
}
// "Lời mời vào nhóm" / link joins (STR_GROUP_INVITATION_JOIN_ERR_*)
const JOIN_ERRORS: Record<number, string> = {
  166: 'Bạn đã bị trưởng nhóm chặn tham gia nhóm này',
  177: 'Bạn đã vượt quá số nhóm cho phép',
  178: 'Đã là thành viên của nhóm',
  212: 'Lời mời tham gia nhóm không tồn tại',
  228: 'Lời mời tham gia nhóm đã hết hạn',
  240: 'Yêu cầu của bạn đã được gửi đến trưởng/phó nhóm chờ phê duyệt',
  257: 'Bạn không có quyền tham gia nhóm vào lúc này',
  259: 'Bạn không có quyền thực hiện thay đổi trong nhóm vào lúc này',
}
// "Các yêu cầu cần được phê duyệt" (STR_APPROVE_MEMBER_ERR_*)
const REVIEW_ERRORS: Record<number, string> = {
  166: NO_PERMISSION,
  170: 'Đã bị từ chối bởi người khác',
  172: 'Nhóm đã vượt quá số lượng thành viên cho phép',
  177: 'Người này đã đạt giới hạn số nhóm tối đa',
  178: 'Đã được approve bởi người khác',
}

// PC's lists of names: "An", "An và Bình", "An và 3 người khác"
const who = (names: string[]) => (names.length > 2 ? `${names[0]} và ${names.length - 1} người khác` : names.join(' và '))

// PC's _getInviteErrorText and invite summary, per error code of invite/v2's error_data
export function inviteError(code: number, names: string[]) {
  const n = who(names)
  switch (code) {
    case 120: return 'Zalo: Bạn đang bị cấm nhắn tin cho người lạ.'
    case 166: return `${n}: có thể người dùng này đã bị chặn và bạn không đủ quyền để thêm họ vào nhóm.`
    case 172: return 'Bạn đã vượt quá số nhóm cho phép.'
    case 173: return 'Có vài người đã vượt quá số nhóm cho phép.'
    case 175: return ''
    case 177: return `${n}: người dùng này đã vượt quá số nhóm cho phép.`
    case 178: return `${n} đã là thành viên của nhóm từ trước`
    case 240: return 'Yêu cầu của bạn đã được gửi đến trưởng/phó nhóm chờ xét duyệt'
    case 245: case 263: return `${n} đã được bạn mời vào nhóm và cần xác nhận tham gia`
    case 252: return `${n} đã nằm trong danh sách chờ duyệt.`
    case 259: return 'Bạn không có quyền thực hiện thay đổi trong nhóm vào lúc này'
    case 262: return `${n} đã được mời trước đây nhưng chưa xác nhận tham gia`
    case 281: return `Không thể thêm ${n} vào nhóm vì họ đã đạt giới hạn trò chuyện có Tin nhắn tự xóa`
    case 317: return `Không thể mời ${n} vào nhóm vì link tham gia nhóm chưa được kích hoạt`
    default: return `Thêm ${n} không thành công (${code})`
  }
}

// PC's getErrorText of "Thêm vào nhóm" (invite/multi), per group; 0 and 178 ("Đã là thành viên") count as added
export function multiInviteError(code: number, name: string) {
  switch (code) {
    case 166: return `Bạn không đủ quyền để thêm ${name} vào nhóm`
    case 173: return `${name} đã vượt quá số nhóm cho phép`
    case 175: case 306: return `${name} đã bị trưởng/phó nhóm chặn tham gia nhóm`
    case 240: return 'Yêu cầu của bạn đã được gửi đến trưởng/phó nhóm chờ xét duyệt'
    case 248: return 'Cần chờ admin phê duyệt'
    case 252: return `${name} đã nằm trong danh sách chờ duyệt`
    case 262: return `${name} đã được mời trước đây nhưng chưa xác nhận tham gia`
    case 263: return `${name} đã được bạn mời vào nhóm và cần xác nhận tham gia`
    case 317: return `Không thể mời ${name} vào nhóm vì link tham gia nhóm chưa được kích hoạt`
    case 177: return 'Đã quá số nhóm cho phép'
    case 281: return 'Không thể thêm người này vào nhóm vì họ đã đạt giới hạn trò chuyện có Tin nhắn tự xóa'
    case 833: return 'Không thể thêm người này vào nhóm vì họ đã đạt giới hạn trò chuyện có Chặn chia sẻ'
    case 247: return 'Chặn thêm vào nhóm lại'
    case 264: return `${name} không thể thêm vào nhóm. Họ sẽ nhận được link mời vào nhóm của bạn.`
    default: return `Mời vào nhóm bị lỗi (${code})`
  }
}

// a Zalo error with a known code becomes PC's text for it
const explain = (...tables: Record<number, string>[]) => (e: unknown): never => {
  const text = e instanceof ZaloApiError && e.code != null ? tables.map((t) => t[e.code!]).find(Boolean) : undefined
  throw text ? new HTTPException(400, { message: text }) : e
}

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
