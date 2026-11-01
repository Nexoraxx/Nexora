export type PinMessage = { msgId: string; cliMsgId: string | null; fromUid: string | null; dName: string | null; msgType: string; message: string | null; msgText: string | null; toUid: string }
export type GroupPinSetting = { setting: string | null; adminIds: string | null; creatorId: string | null }

export type Topic = { id?: string | number; type?: number; params?: unknown; creatorId?: string; createTime?: number }
export type Board = { topics: Topic[]; version: number; limit: number }
