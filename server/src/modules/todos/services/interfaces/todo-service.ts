import type { TodoStatus } from '@hwqnq/zca-js'
import type { CreateTodoRequest } from '../../dtos/requests/todo.request'
import type { Todo } from '../../dtos/responses/todo.response'

export default interface ITodoService {
  // Zalo turns To-Do on per account (login settings' task_setting); read locally, no request
  isEnabled(accountId: string): boolean
  list(accountId: string): Promise<{ enabled: boolean; todos: Todo[] }>
  create(accountId: string, r: CreateTodoRequest): Promise<{ id: string }>
  setStatus(accountId: string, id: string, status: TodoStatus): Promise<void>
  remove(accountId: string, id: string): Promise<void>
  remind(accountId: string, id: string): Promise<void>
}
