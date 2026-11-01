import { inject, injectable } from 'inversify'
import { HTTPException } from 'hono/http-exception'
import { FriendEventType, ReportReason, ThreadType, ZaloApiError, type API, type FriendEvent, type GroupInfoResponse } from '@hwqnq/zca-js'
import { broadcast } from '../../../../core'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import { zaloGet, zaloPost } from '../../../../third-party/zalo/post'
import type { GroupMember, GroupDetails, BlockedUser, UserProfile } from '../../dtos/responses/contact.response'
import type IContactRepository from '../../repositories/interfaces/contact-repository'
import type ISettingsService from '../../../settings/services/interfaces/settings-service'
import type { FindUserRequest } from '../../dtos/requests/contact.request'
import { TOKENS } from '../../../../di/tokens'
import type IContactService from '../interfaces/contact-service'
import {
  GROUP_INFO_BATCH,
  RECEIVED_REQUEST,
  collator,
  ONLINE_TTL,
  NO_SENT_REQUESTS,
  BLOCK_PAGE,
  NO_REQUEST,
  MEMBER_BATCH,
} from '../../constants/contact.constant'
import type { BlockedProfile } from '../../models/contact.model'

@injectable()
export default class ContactService implements IContactService {
  private onlines = new Map<string, { at: number; ids: string[] }>()

  constructor(
    @inject(TOKENS.ContactRepository) private contacts: IContactRepository,
    @inject(ZcaService) private zca: ZcaService,
    @inject(TOKENS.SettingsService) private settings: ISettingsService,
  ) {
    zca.on('attached', (id) => void this.sync(id).catch((e) => console.error(`[${id}] contacts sync`, e)))
    zca.on('friend_event', (id, e) => void this.onFriendEvent(id, e).catch((err) => console.error(`[${id}] friend event`, err)))
  }

  friends(accountId: string) {
    return this.contacts.friends(accountId)
  }

  requests(accountId: string) {
    return this.contacts.requests(accountId)
  }

  groups(accountId: string) {
    return this.contacts.groups(accountId)
  }

  // Zalo PC re-fetches the profile on open, plus the extra info whose groupIds are the mutual groups.
  async profile(accountId: string, userId: string): Promise<UserProfile> {
    const api = this.zca.get(accountId)
    const [extra] = await Promise.all([api.getProfileExtra(userId), this.refreshProfiles(accountId, [userId])])
    const u = this.contacts.profile(accountId, userId)
    if (!u) throw new HTTPException(404, { message: 'Không tìm thấy người dùng' })
    const isFr = u.isFr === 1
    const received = !isFr && u.friendRequestType === RECEIVED_REQUEST
    const sent = !isFr && !received && (await this.sentRequests(accountId)).some((r) => r.userId === userId)
    const mutualGroups = this.contacts.mutualGroups(accountId, extra.groupIds ?? [])
    const { friendRequestType: _, ...profile } = u
    return {
      ...profile,
      status: u.status ?? '',
      sdob: u.sdob ?? '',
      phoneNumber: isFr ? u.phoneNumber || null : null,
      isFr,
      isBlocked: !!u.isBlocked,
      request: received ? 'received' : sent ? 'sent' : null,
      mutualGroups,
    }
  }

  // Zalo PC's 1-1 header ("Vừa truy cập", "Truy cập 5 phút trước"), ms: friends that aren't OAs only, and nothing
  // when this account hides its own status or they hide theirs (lastOnline's settings.show_online_status)
  async lastOnline(accountId: string, userId: string): Promise<number | null> {
    const u = this.contacts.friendType(accountId, userId)
    if (u?.isFr !== 1 || (u.type ?? 0) > 0 || !(await this.settings.showsOnline(accountId))) return null
    const r = await this.zca.get(accountId).lastOnline(userId)
    return r.settings?.show_online_status && r.lastOnline ? Number(r.lastOnline) : null
  }

  // Zalo PC's green dot on "Bạn bè"; none while this account hides its own status. zca's getFriendOnlines
  // JSON-parses every status (throws on a plain one) while PC reads only userId, so the reply is read here.
  // Zalo answers some accounts with HTTP 404: PC only logs it and shows no dots, so a failure counts as nobody online,
  // kept for the same minute so it isn't asked again on every refresh of the list.
  async onlineFriends(accountId: string): Promise<string[]> {
    if (!(await this.settings.showsOnline(accountId))) return []
    const cached = this.onlines.get(accountId)
    if (cached && Date.now() - cached.at < ONLINE_TTL) return cached.ids
    const api = this.zca.get(accountId)
    const ids = await zaloGet<{ onlines?: { userId?: string }[] }>(api, 'profile', '/api/social/friend/onlines', { imei: api.getContext().imei })
      .then((r) => (r.onlines ?? []).flatMap((o) => (o?.userId ? [String(o.userId)] : [])))
      .catch((e: Error) => (console.warn(`[${accountId}] friend/onlines: ${e.message}`), cached?.ids ?? []))
    this.onlines.set(accountId, { at: Date.now(), ids })
    return ids
  }

  // Forced refetch like PC's members screen; profiles are fetched only for members not known yet.
  async group(accountId: string, groupId: string): Promise<GroupDetails> {
    const api = this.zca.get(accountId)
    const [g] = await this.groupInfos(api, [groupId])
    if (!g) throw new HTTPException(404, { message: 'Không tìm thấy nhóm' })
    this.contacts.saveGroups(accountId, [g])
    const isAdmin = g.creatorId === accountId || !!g.adminIds?.includes(accountId)
    // Zalo PC's onlyShowAdminOwner: a locked member list shows non-admins the owner, deputies and themselves
    const locked = !!g.setting?.lockViewMember && !isAdmin
    const ids = locked
      ? [...new Set([g.creatorId, ...(g.adminIds ?? []), accountId])].filter(Boolean)
      : g.memVerList?.length
        ? g.memVerList.map((v) => v.split('_')[0])
        : g.memberIds
    const known = (list: string[]) => new Map(this.contacts.members(accountId, list).map((u) => [u.userId, u]))
    const missing = ((have) => ids.filter((id) => !have.get(id)?.name))(known(ids))
    for (let i = 0; i < missing.length; i += MEMBER_BATCH) {
      // PC's getMemberInGroup POSTs: zca's getGroupMembersInfo GETs, and 100 encrypted ids in the URL plus the
      // cookies are more header than Zalo takes (431)
      const friend_pversion_map = missing.slice(i, i + MEMBER_BATCH).map((id) => `${id}_0`)
      const { profiles } = await zaloPost<{ profiles: Record<string, { id?: string; displayName: string; zaloName: string; avatar: string }> }>(api, 'profile', '/api/social/group/members', { friend_pversion_map })
      this.contacts.upsertUsers(Object.entries(profiles).map(([id, p]) => ({ accountId, userId: p.id || id.split('_')[0], displayName: p.displayName, zaloName: p.zaloName, avatar: p.avatar })))
    }
    const users = known(ids)
    const rank = (m: GroupMember) => (m.role === 'owner' ? 0 : m.role === 'admin' ? 1 : 2)
    const members = ids
      .map((id): GroupMember => {
        const u = users.get(id)
        return { userId: id, name: u?.name ?? id, avatar: u?.avatar ?? '', role: id === g.creatorId ? 'owner' : g.adminIds?.includes(id) ? 'admin' : null, isFr: u?.isFr === 1 }
      })
      .sort((a, b) => rank(a) - rank(b) || collator.compare(a.name, b.name))
    return {
      groupId,
      name: g.name,
      avatar: g.avt,
      desc: g.desc ?? '',
      totalMember: g.totalMember,
      canEdit: !g.setting?.blockName || isAdmin,
      locked,
      setting: g.setting ?? {},
      pending: isAdmin ? (g.pendingApprove?.uids?.length ?? 0) : 0,
      members,
    }
  }

  // After a group event from any device: refetch that group (name, avatar, members, deputies, settings).
  async refreshGroup(accountId: string, groupId: string) {
    this.contacts.saveGroups(accountId, await this.groupInfos(this.zca.get(accountId), [groupId]))
    broadcast({ type: 'contacts', accountId })
    broadcast({ type: 'threads', accountId })
    broadcast({ type: 'group', accountId, groupId })
  }

  forgetGroup(accountId: string, groupId: string) {
    this.contacts.deleteGroup(accountId, groupId)
    broadcast({ type: 'contacts', accountId })
  }

  async renameGroup(accountId: string, groupId: string, name: string) {
    await this.zca.get(accountId).changeGroupName(name, groupId)
    this.contacts.renameGroup(accountId, groupId, name)
    broadcast({ type: 'contacts', accountId })
    broadcast({ type: 'threads', accountId })
  }

  async sentRequests(accountId: string) {
    try {
      return Object.values(await this.zca.get(accountId).getSentFriendRequest())
    } catch (e) {
      if (e instanceof ZaloApiError && e.code === NO_SENT_REQUESTS) return []
      throw e
    }
  }

  async findUser(accountId: string, { phone, username }: FindUserRequest) {
    const api = this.zca.get(accountId)
    const u = await (username ? api.findUserByUsername(username) : api.findUser(phone!))
    if (!u?.uid) return null
    const row = this.contacts.friendFlag(accountId, u.uid)
    return { userId: u.uid, displayName: u.display_name, zaloName: u.zalo_name, avatar: u.avatar, isFr: row?.isFr ?? 0 }
  }

  // Full refresh of friends, aliases and friend requests; groups refetch only where Zalo's version changed.
  async sync(accountId: string) {
    const api = this.zca.get(accountId)
    const [friends, aliases, recomm, { gridVerMap }] = await Promise.all([
      api.getAllFriends(),
      this.aliases(api),
      api.getFriendRecommendations(),
      api.getAllGroups(),
    ])

    const known = new Map(this.contacts.groupVersions(accountId).map((g) => [g.userId, g.version]))
    const infos = await this.groupInfos(api, Object.keys(gridVerMap).filter((id) => known.get(id) !== String(gridVerMap[id])))

    this.contacts.sync(accountId, friends, aliases, recomm, gridVerMap, infos)
    // Zalo's alias list also holds non-friends, whose rows have only the alias until their profile is fetched
    const nameless = this.contacts.nameless(accountId)
    if (nameless.length) await this.refreshProfiles(accountId, nameless.map((u) => u.userId))
    await this.nameCloud(accountId)
    broadcast({ type: 'contacts', accountId })
  }

  // "Cloud của tôi" (PC's send-to-me): its own id from the login, named by Zalo's server (send2me_name, which zca
  // may not keep: PC's Vietnamese name then), its avatar from its profile. Not a friend: no presence, not in "Bạn bè".
  cloud(accountId: string) {
    const { loginInfo } = this.zca.get(accountId).getContext()
    const id = loginInfo?.send2me_id ? String(loginInfo.send2me_id) : null
    return { threadId: id, name: (loginInfo?.send2me_name as { VI?: string } | undefined)?.VI || 'Cloud của tôi' }
  }

  private async nameCloud(accountId: string) {
    const { threadId, name } = this.cloud(accountId)
    if (!threadId) return
    await this.refreshProfiles(accountId, [threadId]).catch(() => {})
    this.contacts.set(accountId, threadId, { displayName: name, zaloName: name, isFr: 0 })
  }

  // Fetch what the account doesn't know yet: strangers writing 1-1 and groups joined since the last sync.
  async ensureKnown(accountId: string, userIds: string[], groupIds: string[]) {
    const missing = (table: 'user' | 'groups', ids: string[]) => [...new Set(ids)].filter((id) => !this.contacts.isKnown(table, accountId, id))
    const users = missing('user', userIds)
    const groups = missing('groups', groupIds)
    if (users.length) await this.refreshProfiles(accountId, users)
    if (groups.length) this.contacts.saveGroups(accountId, await this.groupInfos(this.zca.get(accountId), groups))
    return users.length + groups.length > 0
  }

  private async groupInfos(api: API, groupIds: string[]) {
    const infos: GroupInfoResponse['gridInfoMap'][string][] = []
    for (let i = 0; i < groupIds.length; i += GROUP_INFO_BATCH) {
      const { gridInfoMap } = await api.getGroupInfo(groupIds.slice(i, i + GROUP_INFO_BATCH))
      infos.push(...Object.values(gridInfoMap))
    }
    return infos
  }

  async accept(accountId: string, userId: string) {
    await this.zca.get(accountId).acceptFriendRequest(userId)
    this.update(accountId, userId, { isFr: 1, ...NO_REQUEST })
  }

  async reject(accountId: string, userId: string) {
    await this.zca.get(accountId).rejectFriendRequest(userId)
    this.update(accountId, userId, NO_REQUEST)
  }

  // "Lời mời kết bạn" opened: every received request not seen yet becomes seen. Zalo is told (read-requests) only
  // when its server turns PC's contactTabV2.seen_friendrequest on; by default PC clears its own state only. No
  // "contacts" event: the open list keeps its "Mới" marks until it next reloads.
  async seenRequests(accountId: string) {
    const ids = this.contacts.unseenRequests(accountId, RECEIVED_REQUEST).map((u) => u.userId)
    if (!ids.length) return
    const api = this.zca.get(accountId)
    if (api.getContext().settings?.features?.contactTabV2?.seen_friendrequest) await api.seenFriendRequests(ids)
    for (const userId of ids) this.contacts.set(accountId, userId, { friendRequestRead: 1 })
  }

  async sendRequest(accountId: string, userId: string, message: string) {
    await this.zca.get(accountId).sendFriendRequest(message, userId)
    broadcast({ type: 'contacts', accountId })
  }

  async undoRequest(accountId: string, userId: string) {
    await this.zca.get(accountId).undoFriendRequest(userId)
    broadcast({ type: 'contacts', accountId })
  }

  async removeFriend(accountId: string, userId: string) {
    await this.zca.get(accountId).removeFriend(userId)
    this.update(accountId, userId, { isFr: 0 })
  }

  async setAlias(accountId: string, userId: string, alias: string) {
    const api = this.zca.get(accountId)
    await (alias ? api.changeFriendAlias(alias, userId) : api.removeFriendAlias(userId))
    this.update(accountId, userId, { alias: alias || null })
  }

  // Zalo PC "Danh sách chặn" (Cài đặt → Quyền riêng tư), fetched whole on every open. Being the full list, it also
  // corrects the local isBlocked flags; names follow PC: alias, then display name, then Zalo name.
  async blockList(accountId: string): Promise<BlockedUser[]> {
    const api = this.zca.get(accountId)
    const profiles: BlockedProfile[] = []
    for (let page = 1; ; page++) {
      const r = await api.getBlockList(page, BLOCK_PAGE)
      profiles.push(...((r.profiles ?? []) as BlockedProfile[]))
      if (!r.has_more) break
    }
    const ids = profiles.map((p) => p.userId)
    const blocked = () =>
      this.contacts
        .blocked(accountId)
        .map((u) => u.userId)
        .join()
    const before = blocked()
    this.contacts.replaceBlocked(accountId, profiles)
    // only on a real change: the open list refetches on "contacts"
    if (blocked() !== before) broadcast({ type: 'contacts', accountId })
    const names = new Map(this.contacts.names(accountId, ids).map((u) => [u.userId, u.name]))
    return profiles.map((p) => ({ userId: p.userId, name: names.get(p.userId) || p.userId, avatar: p.avatar ?? '' }))
  }

  // "Báo xấu": users go through PC's report_v2 (abuse-v2, person.profile), groups through the older reportabuse with
  // type 14 — zca sends both as PC does. Reason 0 = "Vấn đề khác", whose description is required.
  // ponytail: no evidence attachments (PC's optional "Đính kèm bằng chứng"); add if Zalo starts asking for them
  async report(accountId: string, targetId: string, isGroup: boolean, reason: ReportReason, content: string) {
    await this.zca
      .get(accountId)
      .sendReport(reason === ReportReason.Other ? { reason, content } : { reason }, targetId, isGroup ? ThreadType.Group : ThreadType.User)
  }

  async setBlocked(accountId: string, userId: string, blocked: boolean) {
    const api = this.zca.get(accountId)
    await (blocked ? api.blockUser(userId) : api.unblockUser(userId))
    this.update(accountId, userId, { isBlocked: Number(blocked) })
  }

  private async onFriendEvent(accountId: string, e: FriendEvent) {
    switch (e.type) {
      case FriendEventType.ADD:
        await this.refreshProfiles(accountId, [e.data])
        this.contacts.set(accountId, e.data, { isFr: 1, ...NO_REQUEST })
        break
      case FriendEventType.REMOVE:
        this.contacts.set(accountId, e.data, { isFr: 0 })
        break
      case FriendEventType.BLOCK:
      case FriendEventType.UNBLOCK:
        this.contacts.set(accountId, e.data, { isBlocked: Number(e.type === FriendEventType.BLOCK) })
        break
      case FriendEventType.REQUEST:
        // isSelf = sent from another device: only the live sent list changes
        if (!e.isSelf) {
          await this.refreshProfiles(accountId, [e.data.fromUid])
          this.contacts.set(accountId, e.data.fromUid, {
            friendRequestType: RECEIVED_REQUEST,
            friendRequestMsg: e.data.message,
            friendRequestSource: e.data.src,
            friendRequestFetchTime: Date.now(),
            friendRequestRead: 0,
          })
        }
        break
      case FriendEventType.UNDO_REQUEST:
        if (!e.isSelf) this.contacts.set(accountId, e.data.fromUid, NO_REQUEST)
        break
      case FriendEventType.REJECT_REQUEST:
        if (e.isSelf) this.contacts.set(accountId, e.data.toUid, NO_REQUEST)
        break
      case FriendEventType.SEEN_FRIEND_REQUEST:
        for (const userId of e.data) this.contacts.set(accountId, userId, { friendRequestRead: 1 })
        break
      default:
        return
    }
    broadcast({ type: 'contacts', accountId })
  }

  private async refreshProfiles(accountId: string, userIds: string[]) {
    const { changed_profiles } = await this.zca.get(accountId).getUserInfo(userIds)
    this.contacts.upsertUsers(Object.entries(changed_profiles).map(([key, p]) => ({ ...p, accountId, userId: p.userId ?? key.split('_')[0] })))
  }

  private async aliases(api: API) {
    const items: { userId: string; alias: string }[] = []
    for (let page = 1; ; page++) {
      const r = await api.getAliasList(100, page)
      items.push(...r.items)
      if (!r.items.length || !(r.hasMore ?? r.items.length === 100)) return items
    }
  }

  private update(accountId: string, userId: string, fields: Record<string, unknown>) {
    this.contacts.set(accountId, userId, fields)
    broadcast({ type: 'contacts', accountId })
  }
}
