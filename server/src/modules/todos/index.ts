import { Hono } from 'hono'
import type ITodoService from './services/interfaces/todo-service'
import { CreateTodoRequest, TodoStatusRequest } from './dtos/requests/todo.request'

// Mounted under /accounts/:accountId. Changes go out on /events as "todos".
export const todoRoutes = (todos: ITodoService) =>
  new Hono()
    .get('/todos', async (c) => c.json(await todos.list(c.req.param('accountId')!)))
    .post('/todos', async (c) => c.json(await todos.create(c.req.param('accountId')!, CreateTodoRequest.parse(await c.req.json()))))
    .put('/todos/:id/status', async (c) => {
      await todos.setStatus(c.req.param('accountId')!, c.req.param('id'), TodoStatusRequest.parse(await c.req.json()).status)
      return c.body(null, 204)
    })
    .delete('/todos/:id', async (c) => {
      await todos.remove(c.req.param('accountId')!, c.req.param('id'))
      return c.body(null, 204)
    })
    .post('/todos/:id/remind', async (c) => {
      await todos.remind(c.req.param('accountId')!, c.req.param('id'))
      return c.body(null, 204)
    })
