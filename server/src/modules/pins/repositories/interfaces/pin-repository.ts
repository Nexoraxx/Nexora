import type { PinMessage, GroupPinSetting } from '../../models/pin.model'

export default interface IPinRepository {
  message(accountId: string, msgId: string): PinMessage | null
  groupSetting(accountId: string, groupId: string): GroupPinSetting | null
  name(accountId: string, userId: string): string | null
  isGroup(accountId: string, threadId: string): boolean
}
