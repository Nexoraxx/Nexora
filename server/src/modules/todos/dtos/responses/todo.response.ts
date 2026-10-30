export type TodoPerson = { userId: string; name: string; avatar: string }
// title: PC's "Tiêu đề" (the todo's description); dueDate ms, -1 none; status: this account's (see list);
// thread: the conversation it was assigned in, msgId its anchor message there
export type Todo = {
  id: string
  title: string
  content: string
  creator: TodoPerson
  assignees: (TodoPerson & { status: number })[]
  watchers: string[]
  dueDate: number
  status: number
  createTime: number
  updateTime: number
  dingTimes: number
  thread: { threadId: string; isGroup: boolean; name: string; avatar: string }
  msgId: string | null
}
