import { z } from 'zod'
import { TodoStatus } from '@hwqnq/zca-js'

// "Giao công việc mới": PC's "Nội dung" ≤ 2000 (a message's text is cut to fit), "Tiêu đề" ≤ 100; dueDate ms, -1 none.
// msgId: "Giao việc" on a message, which becomes the anchor; without it the content is sent to the thread first.
// Empty assignees: the todo goes to this account.
export const CreateTodoRequest = z.object({
  threadId: z.string().min(1, 'Vui lòng chọn nơi tạo công việc'),
  isGroup: z.boolean(),
  msgId: z.string().min(1).optional(),
  content: z.string().trim().min(1, 'Vui lòng nhập nội dung'),
  title: z.string().trim().max(100).default(''),
  assignees: z.array(z.string().min(1)).default([]),
  dueDate: z
    .number()
    .int()
    .refine((t) => t === -1 || t > Date.now(), 'Vui lòng chọn ngày giờ trong tương lai')
    .default(-1),
})
export type CreateTodoRequest = z.infer<typeof CreateTodoRequest>

// -1 "Chưa nhận", 0 "Đã nhận", 1 "Đã hoàn thành"
export const TodoStatusRequest = z.object({ status: z.enum(TodoStatus) })
