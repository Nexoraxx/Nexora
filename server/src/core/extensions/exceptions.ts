import type { Hono } from 'hono'
import { exceptionHandler } from '../exceptions/handlers/exception.handler'

export const useExceptionHandler = (app: Hono) => {
  app.onError(exceptionHandler)
}
