import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ZaloApiError } from '@hwqnq/zca-js'
import { exceptionHandler } from '../exceptions/handlers/exception.handler'

export const useExceptionHandler = (app: Hono) => {
  app.onError(exceptionHandler)
}

export const explain =
  (...tables: Record<number, string>[]) =>
  (e: unknown): never => {
    const text = e instanceof ZaloApiError && e.code != null ? tables.map((t) => t[e.code!]).find(Boolean) : undefined
    throw text ? new HTTPException(400, { message: text }) : e
  }
