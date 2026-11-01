import { GroupEventType, type GroupEvent, type TGroupEventBase } from '@hwqnq/zca-js'
import { GROUP_STATE_EVENTS, YOU, LOCK_VIEW, UNLOCK_VIEW } from '../constants/group-event.constant'
import type { GroupEventContext } from '../models/group-event.model'

// PC's deputy lists: "Bạn, An và 3 người khác"
export const few = (names: string[]) => (names.length > 2 ? `${names.slice(0, 2).join(', ')} và ${names.length - 2} người khác` : names.join(', '))

// Zalo PC's text for a group control event (_processGroupCtrlEvents_old, strings from lang-vi); '' = no message.
export function groupEventText(e: GroupEvent, { me, name, setting, creatorId }: GroupEventContext): string {
  if (!GROUP_STATE_EVENTS.has(e.type)) return ''
  const d = e.data as TGroupEventBase
  if (d.hideGroupInfo) return ''
  // self first, the rest under their local name
  const members = (d.updateMembers ?? [])
    .map((m) => ({ id: m.id, dName: name(m.id) || m.dName }))
    .sort((a, b) => Number(b.id === me) - Number(a.id === me))
  const mine = d.sourceId === me
  const source = mine ? YOU : name(d.sourceId) || ''
  const names = members.map((m) => m.dName).join(', ')
  const you = (list: typeof members) => list.map((m) => (m.id === me ? YOU : m.dName))

  switch (e.type) {
    case GroupEventType.UPDATE:
      return mine ? `Tên nhóm đã đổi thành "${d.groupName}"` : `${source} đổi tên nhóm thành "${d.groupName}"`
    case GroupEventType.UPDATE_AVATAR:
      return mine ? 'Ảnh đại diện nhóm đã thay đổi' : `${source} đổi ảnh đại diện nhóm`
    case GroupEventType.NEW_LINK:
      return d.info?.group_link ? `Link mời tham gia nhóm: ${d.info.group_link}` : ''
    case GroupEventType.UPDATE_SETTING: {
      const next = d.groupSetting
      if (!setting || !next) return ''
      if (!!setting.joinAppr !== !!next.joinAppr)
        return `Hình thức tham gia nhóm được thay đổi thành "${next.joinAppr ? 'Cần phê duyệt' : 'Không cần phê duyệt'}".`
      if (!!setting.lockViewMember !== !!next.lockViewMember) return `${source} ${next.lockViewMember ? LOCK_VIEW : UNLOCK_VIEW}`
      return ''
    }
  }

  if (!members.length) return ''
  switch (e.type) {
    case GroupEventType.JOIN:
      if (members.length === 1 && members[0].id === d.sourceId) {
        // the creator "joining" is the group being created
        if (members[0].id === d.creatorId) return ''
        return members[0].id === me ? 'Bạn vừa tham gia nhóm' : `${members[0].dName} đã tham gia nhóm`
      }
      return `${you(members).join(', ')} được ${mine ? 'bạn' : source} thêm vào nhóm`
    case GroupEventType.LEAVE:
      return `${members[0].dName} đã rời khỏi nhóm`
    case GroupEventType.REMOVE_MEMBER:
      return `${names} được ${mine ? 'bạn' : source} xóa khỏi nhóm`
    case GroupEventType.BLOCK_MEMBER:
      return `${names} bị ${mine ? 'bạn' : source} chặn khỏi nhóm này`
    case GroupEventType.ADD_ADMIN: {
      // a new creatorId is the owner being transferred, which PC shows no message for
      if (creatorId && d.creatorId && creatorId !== d.creatorId) return ''
      const deputies = members.filter((m) => m.id !== (creatorId ?? d.creatorId))
      if (!deputies.length) return ''
      if (deputies.length === 1 && deputies[0].id === me) return 'Bạn đã trở thành phó nhóm'
      return `${few(you(deputies))} đã được bổ nhiệm thành phó nhóm`
    }
    case GroupEventType.REMOVE_ADMIN:
      return `${few(you(members))} đã không còn là phó nhóm`
  }
  return ''
}
