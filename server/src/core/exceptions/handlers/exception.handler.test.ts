import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ZaloApiError } from '@hwqnq/zca-js'
import { exceptionHandler } from './exception.handler'

test("a Zalo error without a message (zca's Error(null) -> \"null\") reads as an unknown error with its code, not \"null\"", async () => {
  const app = new Hono()
    .onError(exceptionHandler)
    .get('/silent', () => {
      throw new ZaloApiError(null as unknown as string, 1022)
    })
    .get('/told', () => {
      throw new ZaloApiError('Nhóm không tồn tại', 165)
    })
  const silent = await app.request('/silent')
  expect(silent.status).toBe(502)
  expect(await silent.json()).toEqual({ error: 'Lỗi không xác định (mã 1022)', code: 1022 })
  expect(await (await app.request('/told')).json()).toEqual({ error: 'Nhóm không tồn tại', code: 165 })
})
