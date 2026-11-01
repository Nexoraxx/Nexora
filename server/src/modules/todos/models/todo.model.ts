// people come as ids or { uid | userId | id, status }, the lists as JSON strings at times (PC's classifyTodoItem)
export type Ref = string | number | { uid?: string; userId?: string; id?: string; status?: number }
export type Extra = { toUid?: string | number; isGroup?: boolean; msgId?: string | number }
export type RawTodo = {
  id: string | number
  creator: string | number
  assignees?: Ref[] | string
  watchers?: Ref[] | string
  content?: string
  description?: string
  dueDate?: number
  status?: number
  createTime?: number
  updateTime?: number
  dingTimes?: number
  extra?: Extra | string
}
export type Verify = { scrollId?: string; updated?: RawTodo[]; deleted?: (string | number | { id: string | number; ts: number })[] }
