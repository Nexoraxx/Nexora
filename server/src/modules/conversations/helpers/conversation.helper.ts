import { createHash } from 'node:crypto'
import { ThreadType } from '@hwqnq/zca-js'

export const next8AM = () => {
  const t = new Date()
  if (t.getHours() >= 8) t.setDate(t.getDate() + 1)
  return t.setHours(8, 0, 0, 0)
}
// Zalo prefixes conversation ids with u/g; thread ids here are bare
export const bare = (id: string) => id.replace(/^[ug]/, '')
export const type = (isGroup: boolean) => (isGroup ? ThreadType.Group : ThreadType.User)
export const md5 = (s: string) => createHash('md5').update(s).digest('hex')
// ponytail: labels keep PC's own conversation ids ("g" + id for groups) as far as can be told; check against a real list
export const labelKey = (threadId: string, isGroup: boolean) => (isGroup ? `g${threadId}` : threadId)
