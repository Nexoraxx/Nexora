import { inject, injectable } from 'inversify'
import { HTTPException } from 'hono/http-exception'
import type { API, User } from '@hwqnq/zca-js'
import { broadcast } from '../../../../core'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import { zaloGet, zaloPost } from '../../../../third-party/zalo/post'
import type { AutoReplyRequest } from '../../dtos/requests/auto-reply.request'
import type { AutoReply } from '../../dtos/responses/auto-reply.response'
import type IAutoReplyService from '../interfaces/auto-reply-service'

const DAY = 86_400_000
const DAILY = ['RRULE:FREQ=DAILY;']

type PkgConfig = { enable?: Record<string, number>; config?: Record<string, Record<string, number>> }


export function anchor(start: number, end: number, now = Date.now()) {
  const base = new Date(now - DAY).setHours(0, 0, 0, 0)
  const from = base + start
  let to = base + end
  if (Math.abs(end - start) >= DAY || Math.abs(end - start) < 1000) to = from + DAY
  else if (from > to) to += DAY
  return { startTime: from, endTime: to }
}


@injectable()
export default class AutoReplyService implements IAutoReplyService {
  constructor(@inject(ZcaService) private zca: ZcaService) {
    zca.on('control', (id, c) => c.act_type === 'auto_reply' && broadcast({ type: 'auto_replies', accountId: id }))
  }

  async list(accountId: string) {
    const api = this.zca.get(accountId)
    const pkg = await this.pkg(accountId, api)
    if (!pkg.enabled) return { ...pkg, rules: [] as AutoReply[] }
    const r = await zaloGet<{ item?: AutoReply[] }>(api, 'auto_reply', '/api/autoreply/list', { version: 0, cliLang: 'vi' })
    return { ...pkg, rules: (r.item ?? []).map((i) => ({ ...i, uids: (i.uids ?? []).map(String) })) }
  }

  async create(accountId: string, rule: AutoReplyRequest) {
    const { enabled, maxRules, rules } = await this.list(accountId)
    if (!enabled) throw new HTTPException(403, { message: 'Tính năng dành cho tài khoản zBusiness' })
    if (rules.length >= maxRules) throw new HTTPException(400, { message: 'Đã đạt số lượng trả lời tự động tối đa' })
    await this.write(accountId, 'create', { enable: false, ...this.fields(rule), recurrence: DAILY })
  }

  async update(accountId: string, id: number, rule: AutoReplyRequest) {
    const current = await this.find(accountId, id)
    await this.write(accountId, 'update', { id, enable: current.enable, ...this.fields(rule), recurrence: current.recurrence?.length ? current.recurrence : DAILY })
  }

  // PC sends the rule back as Zalo returned it, with only enable flipped
  async setEnabled(accountId: string, id: number, enable: boolean) {
    const { maxActive, rules } = await this.list(accountId)
    const current = rules.find((r) => r.id === id)
    if (!current) throw new HTTPException(404, { message: 'Không tìm thấy tin trả lời tự động' })
    if (enable && rules.filter((r) => r.enable && r.id !== id).length >= maxActive) throw new HTTPException(400, { message: 'Đã đạt số lượng trả lời hoạt động tối đa' })
    const { id: _, enable: __, ...rest } = current
    await this.write(accountId, 'update', { id, enable, ...rest, recurrence: current.recurrence?.length ? current.recurrence : DAILY })
  }

  async remove(accountId: string, id: number) {
    await this.write(accountId, 'delete', { id })
  }

  private fields({ content, start, end, scope, uids }: AutoReplyRequest) {
    return { content, ...anchor(start, end), scope, uids }
  }

  private async find(accountId: string, id: number) {
    const rule = (await this.list(accountId)).rules.find((r) => r.id === id)
    if (!rule) throw new HTTPException(404, { message: 'Không tìm thấy tin trả lời tự động' })
    return rule
  }

  private async write(accountId: string, action: 'create' | 'update' | 'delete', params: Record<string, unknown>) {
    await zaloPost(this.zca.get(accountId), 'auto_reply', `/api/autoreply/${action}`, { cliLang: 'vi', ...params }, true)
    broadcast({ type: 'auto_replies', accountId })
  }

  // the account's package (me-v2's bizPkg.pkgId, 0 for a personal account) against the server's ar config
  private async pkg(accountId: string, api: API) {
    const ar = api.getContext().settings?.features?.ba_config?.ba_pkg_config?.ar as PkgConfig | undefined
    const profile = (await api.fetchAccountInfo()).profile as User & { bizInfo?: { pkgId?: number } }
    const pkgId = String(profile.bizPkg?.pkgId ?? profile.bizInfo?.pkgId ?? 0)
    return {
      enabled: !!ar?.enable?.[pkgId],
      maxRules: Number(ar?.config?.limit_template_create?.[pkgId] ?? 0),
      maxActive: Number(ar?.config?.limit_template_active?.[pkgId] ?? 0),
    }
  }
}
