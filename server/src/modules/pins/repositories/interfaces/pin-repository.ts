export type PinMessage = { msgId: string; cliMsgId: string | null; fromUid: string | null; dName: string | null; msgType: string; message: string | null; msgText: string | null; toUid: string }
export type GroupPinSetting = { setting: string | null; adminIds: string | null; creatorId: string | null }

export default interface IPinRepository {
  message(accountId: string, msgId: string): PinMessage | null
  groupSetting(accountId: string, groupId: string): GroupPinSetting | null
  name(accountId: string, userId: string): string | null
  isGroup(accountId: string, threadId: string): boolean
}
