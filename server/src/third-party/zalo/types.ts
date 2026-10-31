import { API, DeliveredMessage, FriendEvent, GroupEvent, Message, Reaction, SeenMessage, ThreadType, Typing, Undo } from "@hwqnq/zca-js"
import { AccountStatus } from "../../modules/accounts/dtos/responses/account.response"
import type { Control } from "./controls"

export type ZcaEvents = {
  status: [accountId: string, status: AccountStatus]
  message: [accountId: string, message: Message]
  old_messages: [accountId: string, messages: Message[], type: ThreadType]
  undo: [accountId: string, undo: Undo]
  reaction: [accountId: string, reaction: Reaction]
  seen_messages: [accountId: string, seens: SeenMessage[]]
  delivered_messages: [accountId: string, delivereds: DeliveredMessage[]]
  typing: [accountId: string, typing: Typing]
  old_reactions: [accountId: string, reactions: Reaction[], isGroup: boolean]
  friend_event: [accountId: string, event: FriendEvent]
  group_event: [accountId: string, event: GroupEvent]
  attached: [accountId: string, api: API]
  // the socket closed for good without being kicked: the account should log in again
  dropped: [accountId: string]
  // websocket got its cipher key: offline queues can be requested
  ready: [accountId: string]
  voip: [accountId: string, control: VoipControl]
  sync_event: [accountId: string, control: SyncControl]
  // controls zca's listener drops (conv_settings, ...)
  control: [accountId: string, control: Control]
}


export type VoipControl = { act_type: 'voip'; act: string; data: unknown }
export type VoicecallProps = { path: string; params: Record<string, unknown> }
export type VoicecallApi = API & { voicecall(props: VoicecallProps): Promise<unknown> }

export type SyncControl = { act_type?: string; act?: string; data: unknown }
export type SyncMessagesProps = { path: string; params: Record<string, unknown> }
export type NoiseIdsRequest = { fids?: number[]; gids?: number[] }
export type NoiseIdsResponse = { fids?: string[]; gids?: string[] }
export type MiniProfile = { userId?: string; displayName?: string; zaloName?: string; avatar?: string }
export type MiniProfilesProps = { friend_ids: string[] }
export type SyncApi = API & {
  syncMessages(props: SyncMessagesProps): Promise<unknown>
  znoise(props: NoiseIdsRequest): Promise<NoiseIdsResponse>
  getminiprofiles(props: MiniProfilesProps): Promise<Record<string, MiniProfile>>
}