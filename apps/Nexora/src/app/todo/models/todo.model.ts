export type TodoPerson = { userId: string; name: string; avatar: string };
// title: PC's "Tiêu đề"; dueDate ms, -1 none; status: this account's (its own assignee entry, "Chưa nhận" counting as
// "Đã nhận" for its creator; else the todo's); thread: the conversation it was assigned in, msgId its anchor there
export type Todo = {
  id: string;
  title: string;
  content: string;
  creator: TodoPerson;
  assignees: (TodoPerson & { status: number })[];
  watchers: string[];
  dueDate: number;
  status: number;
  createTime: number;
  updateTime: number;
  dingTimes: number;
  thread: { threadId: string; isGroup: boolean; name: string; avatar: string };
  msgId: string | null;
};
// enabled: Zalo turned To-Do on for the account (PC's task_setting, off by default)
export type TodoList = { enabled: boolean; todos: Todo[] };
// the conversation to open at the todo's source message (App's ChatTarget)
export type TodoTarget = { threadId: string; isGroup: boolean; name: string | null; avatar: string | null; msgId?: string };
