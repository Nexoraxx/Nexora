import type { ServerEvent } from "@/shared/types";
import { server } from "@/core/http/api";

// One socket for the whole app; components add and remove listeners.
const listeners = new Set<(e: ServerEvent) => void>();
let socket: Promise<WebSocket> | undefined;

export function onEvent(listener: (e: ServerEvent) => void) {
  listeners.add(listener);
  socket ??= server.then(({ port, token }) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/events?token=${token}`);
    ws.onmessage = (e) => listeners.forEach((l) => l(JSON.parse(e.data)));
    return ws;
  });
  return () => void listeners.delete(listener);
}
