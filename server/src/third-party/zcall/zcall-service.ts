import { appendFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir, release, type } from 'node:os'
import { join } from 'node:path'
import { HTTPException } from 'hono/http-exception'
import { config } from '../../config'
import { inject, injectable } from 'inversify'
import { TOKENS } from '../../di/tokens'
import type IAccountRepository from '../../modules/accounts/repositories/interfaces/account-repository'
import { controlData } from '../zalo/controls'
import { API_VERSION } from '../zalo/constants'
import { zaloGet } from '../zalo/post'
import { ZcaService } from '../zalo/zalo-client'
import { NativeLink, type NativeMessage } from './zcall-ipc'

type Args = Record<string, unknown>
type Signal = [path: string, params: (n: Args, imei: string) => Args]

// Zalo PC renderer handleSendSignal + its HTTP helpers (f6H+): the helper names a signal, the host sends it.
// extendData (and subCommand 3) only when the helper gave one.
const ext = (n: Args) => (n.extendData ? { extendData: n.extendData, subCommand: 3 } : {})
const SIGNALS: Record<number, Signal> = {
  401: ['requestcall', (n, imei) => ({ calleeId: n.calleeId, callId: n.callId, codec: n.codec ?? '[]', typeRequest: n.type, imei })],
  416: ['request', (n, imei) => ({ calleeId: n.calleeId, rtcpAddress: n.rtcpAddress, rtpAddress: n.rtpAddress, codec: n.codec, session: n.session, callId: n.callId, imei, ...ext(n) })],
  407: ['ringring', (n, imei) => ({ callerId: n.callerId, callId: n.callId, status: 0, imei })],
  402: ['answer', (n) => ({ callerId: n.callerId, callId: n.callId, status: n.status, codec: n.codec || '', rtcpAddress: n.rtcpAddress, rtpAddress: n.rtpAddress, session_id: n.session, ...ext(n) })],
  408: ['answerack', (n, imei) => ({ calleeId: n.calleeId, callId: n.callId, status: 0, imei })],
  405: ['cancel', (n, imei) => ({ callerId: n.toId, callId: n.callId, callType: n.callType, status: 0, imei })],
  406: ['logendcall', (n, imei) => ({ call_id: n.callId, partner_id: n.partnerId, status: n.status, logdata: n.data, duration: n.duration, role: n.role, imei })],
  409: ['endcall', (n, imei) => ({ uidTo: n.toId, callId: n.callId, status: 3, imei })],
  411: ['holdreq', (n) => ({ toId: n.toId })],
  412: ['holdresp', (n) => ({ toId: n.toId })],
  413: ['unholdreq', (n) => ({ toId: n.toId })],
  414: ['unholdresp', (n) => ({ toId: n.toId })],
  12006: ['conf', (n) => ({ calleeId: n.calleeId, callId: n.callId, isOnCam: n.isOnCam, isOnMic: n.isOnMic, data: n.data })],
  12064: ['requestsharescreen', (n) => ({ uidTo: n.uidTo, callId: n.callId, status: n.status })],
}
// call.retry_timers: logendcall is retried until it lands
const RETRY_406 = [1e3, 1e3, 2e3, 3e3, 5e3, 8e3, 13e3]
// 1-1 acts only; group calls are not supported
const ACTS = new Set(['request', 'ring_ring', 'answer', 'answer_ack', 'cancel', 'end_call', 'onoff_camera', 'mute_audio', 'share_screen'])

// The call engine: Zalo PC's own ZaloCall where Zalo PC is installed (macOS, Windows); on Linux, which Zalo never
// shipped one for, Nexora's port (the app run as `nexora --zcall`, path passed in by Tauri). NEXORA_CALL_HELPER overrides it.
type Helper = { exe: string; args: string[] }
function findHelper(): Helper | undefined {
  if (process.env.NEXORA_CALL_HELPER) return { exe: process.env.NEXORA_CALL_HELPER, args: [] }
  if (process.platform === 'linux') return process.env.NEXORA_APP_EXE ? { exe: process.env.NEXORA_APP_EXE, args: ['--zcall'] } : undefined
  const candidates: string[] = []
  if (process.platform === 'darwin')
    for (const app of ['/Applications/Zalo.app', join(homedir(), 'Applications/Zalo.app')]) candidates.push(join(app, 'Contents/ZaloHelper.app/Contents/MacOS/ZaloCall'))
  else if (process.platform === 'win32')
    // per-user install: <LOCALAPPDATA>\Programs\Zalo\Zalo-<version>\plugins\capture\ZaloCall.exe, newest first
    for (const root of [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Zalo'), process.env.ProgramFiles && join(process.env.ProgramFiles, 'Zalo')]) {
      if (!root || !existsSync(root)) continue
      const versions = readdirSync(root).filter((d) => /^Zalo-\d/.test(d)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      for (const dir of [...versions.map((v) => join(root, v)), root]) candidates.push(join(dir, 'plugins', 'capture', 'ZaloCall.exe'))
    }
  const exe = candidates.find((p) => existsSync(p))
  return exe ? { exe, args: [] } : undefined
}

// the call pushes, next to the engine's own lines in the call log it writes (init logPath)
const trace = (line: string) => {
  console.log(`[zcall] ${line}`)
  try {
    appendFileSync(join(config.dataDir, 'call.log'), `${(Date.now() / 1000).toFixed(3)} host: ${line}\n`)
  } catch {}
}

@injectable()
export class ZcallService {
  private links = new Map<string, NativeLink>()
  private inCall = new Set<string>()

  constructor(
    @inject(ZcaService) private zca: ZcaService,
    @inject(TOKENS.AccountRepository) private accounts: IAccountRepository,
  ) {
    zca.on('control', (accountId, c) => c.act_type === 'voip' && this.onVoip(accountId, c.act ?? '', controlData<Args>(c)))
    zca.on('status', (accountId, status) => (status === 'offline' || status === 'kicked') && this.links.get(accountId)?.close())
  }

  makeCall(accountId: string, partner: { id: string; name: string; avatar: string }, video: boolean) {
    this.zca.get(accountId)
    if (this.inCall.size) throw new HTTPException(409, { message: 'Bạn đang ở trong một cuộc gọi khác' })
    // type: 1 voice, 3 video (5/6 group)
    this.link(accountId).send({ type: 'request', command: 'makeCall', data: { partner: [partner], type: video ? 3 : 1 } })
  }

  // OU7N.handleControl: drop pushes older than 60 s, tell the helper when this device is already in a call
  private onVoip(accountId: string, act: string, data: Args) {
    trace(`voip ${act} for ${accountId}, ${Date.now() - Number(data?.ts ?? Date.now())} ms old, engine ${this.links.has(accountId) ? 'running' : 'not running'}`)
    if (!ACTS.has(act) || Date.now() - Number(data?.ts ?? Date.now()) > 60_000) return
    const control: Args = { act_type: 'voip', act, data }
    if (act === 'request') control.inCallStatus = this.inCall.size ? 'zalo' : null
    // only an incoming call starts the helper; the rest belong to a call it already runs
    let link = this.links.get(accountId)
    if (!link && act === 'request')
      try {
        link = this.link(accountId)
      } catch {
        return console.warn(`[zcall] incoming call for ${accountId} but no call engine on this machine`)
      }
    link?.send({ type: 'control', data: control })
  }

  private link(accountId: string) {
    const running = this.links.get(accountId)
    if (running) return running
    const helper = findHelper()
    if (!helper)
      throw new HTTPException(501, {
        message: process.platform === 'linux' ? 'Không tìm thấy bộ gọi của Nexora' : 'Cần cài Zalo PC trên máy này để gọi thoại/video',
      })
    const link = new NativeLink(
      helper.exe,
      helper.args,
      () => this.initData(accountId),
      (m) => void this.onNative(accountId, m).catch((e) => console.error('[zcall]', e)),
      () => {
        this.links.delete(accountId)
        this.setInCall(accountId, false)
      },
    )
    this.links.set(accountId, link)
    return link
  }

  // OU7N.getInitialData; no device choice (the helper takes the system defaults)
  private initData(accountId: string) {
    const me = this.accounts.list().find((a) => a.id === accountId)
    const voip = (this.zca.get(accountId).getContext().settings?.features?.voip ?? {}) as Args
    return {
      type: 'update',
      command: 'init',
      data: {
        local: { id: accountId, name: me?.name ?? '', avatar: me?.avatar ?? '' },
        osInfo: `${type()}_${release()}_${process.platform}_${process.arch}`,
        mainWindowId: accountId,
        logPath: join(config.dataDir, 'call.log'),
        zrtcLogPath: join(config.dataDir, 'zrtc.log'),
        dumpPath: join(config.dataDir, 'crash.dmp'),
        clientVersion: API_VERSION,
        language: 'vi',
        timeoutMakeCall2ZRtp: 0,
        enablePreviewDeviceOutgoing: voip.enable_preview_device_outgoing,
        enablePreviewDeviceIncall: voip.enable_preview_device_incall,
        enableUnstableConnecting: voip.enable_unstable_connecting,
        autoAudioInput: true,
        autoAudioOutput: true,
      },
    }
  }

  private async onNative(accountId: string, m: NativeMessage) {
    const link = this.links.get(accountId)
    if (m.type === 'sendSignal') return this.signal(accountId, Number(m.command), (m.data ?? {}) as Args)
    if (m.type === 'update' && m.command === 'callState') return this.setInCall(accountId, (m.data as Args)?.state !== 'free')
    if (m.type !== 'request') return
    if (m.command === 'killMe') return link?.close()
    if (m.command === 'serverTime') return link?.send({ type: 'response', command: 'serverTime', data: { timestamp: Date.now() } })
    if (m.command === 'getAliasName') return link?.send({ type: 'response', command: 'getAliasName', data: { noisedId: (m.data as Args)?.noisedId, aliasName: '' } })
  }

  // the HTTP call the helper asked for; its decoded data goes back as recvSignal (nothing on failure, as PC)
  private async signal(accountId: string, command: number, n: Args, attempt = 0): Promise<void> {
    const signal = SIGNALS[command]
    if (!signal) return console.warn(`[zcall] unsupported signal ${command}`)
    const api = this.zca.get(accountId)
    try {
      const data = await zaloGet(api, 'voice_call', `/api/voicecall/${signal[0]}`, signal[1](n, api.getContext().imei))
      this.links.get(accountId)?.send({ type: 'recvSignal', command, data })
    } catch (e) {
      console.error(`[zcall] signal ${command}`, e)
      if (command === 406 && attempt < RETRY_406.length) setTimeout(() => void this.signal(accountId, command, n, attempt + 1), RETRY_406[attempt])
    }
  }

  private setInCall(accountId: string, on: boolean) {
    if (on) this.inCall.add(accountId)
    else this.inCall.delete(accountId)
  }
}
