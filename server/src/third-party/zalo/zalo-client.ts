import { EventEmitter } from 'node:events'
import { injectable } from "inversify";
import { HTTPException } from 'hono/http-exception'
import { API, CloseReason, Zalo, type Credentials, type LoginQRCallback } from '@hwqnq/zca-js';
import { ZcaEvents } from './types';
import { API_TYPE, API_VERSION } from './constants';
import { tapControls } from './controls';

// selfListen: actions done on the phone (accept, block, ...) must reach us too
const newZalo = () => new Zalo({ apiType: API_TYPE, apiVersion: API_VERSION, selfListen: true, checkUpdate: false, logging: false })

@injectable()
export class ZcaService extends EventEmitter<ZcaEvents> {
    private sessions = new Map<string, API>()

    login(credentials: Credentials) {
        return newZalo().login(credentials)
    }

    loginQR(callback: LoginQRCallback) {
        return newZalo().loginQR(undefined, callback)
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
            this.sessions.delete(accountId)
            // 3000: Zalo Web/PC opened elsewhere took the listener over
            const kicked = code === CloseReason.DuplicateConnection || code === CloseReason.KickConnection
            this.emit('status', accountId, kicked ? 'kicked' : 'offline')
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
        listener.start({ retryOnClose: true })
        this.emit('attached', accountId, api)
    }

    detach(accountId: string) {
        const api = this.sessions.get(accountId)
        if (!api) return
        this.sessions.delete(accountId)
        api.listener.removeAllListeners()
        api.listener.on('error', () => {})
        api.listener.stop()
        this.emit('status', accountId, 'offline')
    }
}
