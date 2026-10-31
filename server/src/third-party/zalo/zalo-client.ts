import { EventEmitter } from 'node:events'
import { injectable } from "inversify";
import { HTTPException } from 'hono/http-exception'
import { API, CloseReason, Zalo, type Credentials, type LoginQRCallback } from '@hwqnq/zca-js';
import { ZcaEvents } from './types';
import { API_TYPE, API_VERSION, USER_AGENT } from './constants';
import { tapControls } from './controls';

// selfListen: actions done on the phone (accept, block, ...) must reach us too
const newZalo = () => new Zalo({ apiType: API_TYPE, apiVersion: API_VERSION, selfListen: true, checkUpdate: false, logging: false })

// zca keeps its socket private; the watchdog needs to see its frames and drop it
type Socket = { readyState: number; onmessage: ((e: unknown) => unknown) | null; terminate(): void }
const socketOf = (api: API) => (api.listener as unknown as { ws: Socket | null }).ws
// Zalo answers every ping (Zalo PC's _onPong), so a socket that hears nothing for 3 pings is dead: after a suspend or
// a network switch the OS keeps it "open" for many minutes. Zalo PC drops it the same way (ping_max_timeout).
const silentLimit = (api: API) => Math.max(3 * (Number(api.getContext().settings?.features?.socket?.ping_interval) || 30_000), 60_000)

@injectable()
export class ZcaService extends EventEmitter<ZcaEvents> {
    private sessions = new Map<string, API>()
    private watchdogs = new Map<string, ReturnType<typeof setInterval>>()

    login(credentials: Credentials) {
        return newZalo().login(credentials)
    }

    loginQR(callback: LoginQRCallback) {
        return newZalo().loginQR({ userAgent: USER_AGENT }, callback)
    }

    get(accountId: string) {
        const api = this.sessions.get(accountId)
        if (!api) throw new HTTPException(409, { message: 'Tài khoản chưa kết nối' })
        return api
    }

    has(accountId: string) {
        return this.sessions.has(accountId)
    }

    attach(accountId: string, api: API) {
        this.detach(accountId)
        this.sessions.set(accountId, api)
        const { listener } = api
        listener.on('connected', () => this.emit('status', accountId, 'online'))
        listener.on('disconnected', () => this.emit('status', accountId, 'connecting'))
        listener.on('closed', (code) => {
            this.stopWatchdog(accountId)
            this.sessions.delete(accountId)
            // 3000: Zalo Web/PC opened elsewhere took the listener over; staying off is what lets that one keep it
            const kicked = code === CloseReason.DuplicateConnection || code === CloseReason.KickConnection
            // anything else (1006 after a network drop or a suspend, zca out of retries) is reconnected by AccountService
            if (kicked) this.emit('status', accountId, 'kicked')
            else this.emit('dropped', accountId)
        })
        listener.on('error', (e) => console.error(`[${accountId}] listener error`, e))
        listener.on('friend_event', (e) => this.emit('friend_event', accountId, e))
        listener.on('group_event', (e) => this.emit('group_event', accountId, e))
        listener.on('cipher_key', () => this.emit('ready', accountId))
        listener.on('message', (m) => this.emit('message', accountId, m))
        listener.on('old_messages', (m, type) => this.emit('old_messages', accountId, m, type))
        listener.on('undo', (u) => this.emit('undo', accountId, u))
        listener.on('reaction', (r) => this.emit('reaction', accountId, r))
        listener.on('old_reactions', (r, isGroup) => this.emit('old_reactions', accountId, r, isGroup))
        listener.on('seen_messages', (s) => this.emit('seen_messages', accountId, s))
        listener.on('delivered_messages', (d) => this.emit('delivered_messages', accountId, d))
        listener.on('typing', (t) => this.emit('typing', accountId, t))
        tapControls(listener, (c) => this.emit('control', accountId, c))
        this.emit('status', accountId, 'connecting')
        this.startWatchdog(accountId, api)
        listener.start({ retryOnClose: true })
        this.emit('attached', accountId, api)
    }

    // Drops a socket that went silent; zca then retries it or gives up ("closed" → reconnect), either way it recovers.
    private startWatchdog(accountId: string, api: API) {
        let heard = Date.now()
        // zca sets onmessage before the socket opens: wrap it so every frame (pongs included) counts
        api.listener.on('connected', () => {
            heard = Date.now()
            const ws = socketOf(api)
            const handle = ws?.onmessage
            if (ws && handle) ws.onmessage = (e) => ((heard = Date.now()), handle.call(ws, e))
        })
        const limit = silentLimit(api)
        this.watchdogs.set(
            accountId,
            setInterval(() => {
                const ws = socketOf(api)
                if (ws?.readyState !== 1 || Date.now() - heard < limit) return
                console.warn(`[${accountId}] socket silent for ${Math.round((Date.now() - heard) / 1000)}s, dropping it`)
                heard = Date.now()
                ws.terminate()
            }, 15_000),
        )
    }

    private stopWatchdog(accountId: string) {
        clearInterval(this.watchdogs.get(accountId))
        this.watchdogs.delete(accountId)
    }

    detach(accountId: string) {
        const api = this.sessions.get(accountId)
        if (!api) return
        this.stopWatchdog(accountId)
        this.sessions.delete(accountId)
        api.listener.removeAllListeners()
        api.listener.on('error', () => {})
        api.listener.stop()
        this.emit('status', accountId, 'offline')
    }
}
