import { ThreadType } from '@hwqnq/zca-js'

export const type = (isGroup: boolean) => (isGroup ? ThreadType.Group : ThreadType.User)
