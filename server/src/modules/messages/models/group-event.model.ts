import { type GroupSetting } from '@hwqnq/zca-js'

export type GroupEventContext = {
  me: string
  // alias or display name known locally, as PC's getDName
  name: (userId: string) => string | null | undefined
  // group state before this event
  setting?: Partial<GroupSetting> | null
  creatorId?: string | null
}
