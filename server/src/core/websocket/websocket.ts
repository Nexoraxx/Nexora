import type { Server, ServerWebSocket } from 'bun'
import { getBunServer, upgradeWebSocket } from 'hono/bun'
import type { ServerEvent } from '../../types'

let server: Server<unknown> | undefined

export const topicWebSocket = (topic: string, handlers: { opened?: (send: (m: string) => void) => void; message?: (m: string) => void } = {}) =>
  upgradeWebSocket((c) => {
    server ??= getBunServer(c)
    return {
      onOpen: (_, ws) => {
        ;(ws.raw as ServerWebSocket).subscribe(topic)
        handlers.opened?.((m) => ws.send(m))
      },
      onMessage: (e) => handlers.message?.(String(e.data)),
    }
  })

export const publish = (topic: string, data: string | Uint8Array) => server?.publish(topic, data)

export const eventsWebSocket = topicWebSocket('events')

export const broadcast = (e: ServerEvent) => publish('events', JSON.stringify(e))