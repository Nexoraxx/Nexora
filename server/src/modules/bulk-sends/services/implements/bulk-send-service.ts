import { inject, injectable } from 'inversify'
import { HTTPException } from 'hono/http-exception'
import { broadcast } from '../../../../core'
import { TOKENS } from '../../../../di/tokens'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import type IMessageService from '../../../messages/services/interfaces/message-service'
import type { CreateBulkSendRequest, PreviewRequest, TemplateRequest } from '../../dtos/requests/bulk-send.request'
import type { Preview } from '../../dtos/responses/bulk-send.response'
import type IBulkSendRepository from '../../repositories/interfaces/bulk-send-repository'
import type IBulkSendService from '../interfaces/bulk-send-service'
import { MIN_GAP, MAX_GAP, MAX_FAILS, RESTARTED, NOT_FOUND, BUSY } from '../../constants/bulk-send.constant'
import { notSent, describe } from '../../helpers/bulk-send.helper'
import { missingIn, render, valuesOf } from '../../helpers/template.helper'

// "Gửi hàng loạt": one text, filled in per person from a {{variable}} template, sent to picked friends one at a time
// with a random gap. A run lives in SQLite, so a restart pauses it where it was instead of losing or repeating it.
@injectable()
export default class BulkSendService implements IBulkSendService {
  // runs whose loop is going in this process
  private looping = new Set<number>()
  // tests swap these
  sleep = (ms: number) => Bun.sleep(ms)
  gap = () => MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP)

  constructor(
    @inject(TOKENS.BulkSendRepository) private repo: IBulkSendRepository,
    @inject(ZcaService) private zca: ZcaService,
    @inject(TOKENS.MessageService) private messages: IMessageService,
  ) {
    repo.recover(RESTARTED)
  }

  templates() {
    return this.repo.templates()
  }

  createTemplate({ name, body }: TemplateRequest) {
    return { id: this.repo.createTemplate(name, body) }
  }

  updateTemplate(id: number, { name, body }: TemplateRequest) {
    if (!this.repo.updateTemplate(id, name, body)) throw new HTTPException(404, { message: 'Không tìm thấy mẫu tin' })
  }

  removeTemplate(id: number) {
    this.repo.removeTemplate(id)
  }

  list(accountId: string) {
    return this.repo.sends(accountId)
  }

  recipients(accountId: string, id: number) {
    this.get(accountId, id)
    return this.repo.recipients(id)
  }

  preview(accountId: string, { body, userIds }: PreviewRequest): Preview {
    const missing: Preview['missing'] = {}
    const items = this.fill(accountId, body, userIds).map(({ friend, text, lacks }) => {
      for (const k of lacks) (missing[k] ??= []).push(friend.userId)
      return { userId: friend.userId, name: friend.alias || friend.displayName || friend.zaloName || friend.userId, text }
    })
    return { items, missing }
  }

  create(accountId: string, { name, body, userIds }: CreateBulkSendRequest) {
    if (this.repo.runningOther(accountId)) throw new HTTPException(409, { message: BUSY })
    const id = this.repo.create(accountId, name, this.fill(accountId, body, userIds).map(({ friend, text }) => ({ userId: friend.userId, text })))
    this.changed(accountId)
    void this.loop(id)
    return { id }
  }

  pause(accountId: string, id: number) {
    if (this.get(accountId, id).state !== 'running') return
    this.repo.setState(id, 'paused')
    this.changed(accountId)
  }

  resume(accountId: string, id: number) {
    if (this.get(accountId, id).state !== 'paused') return
    if (this.repo.runningOther(accountId, id)) throw new HTTPException(409, { message: BUSY })
    this.repo.setState(id, 'running')
    this.changed(accountId)
    void this.loop(id)
  }

  cancel(accountId: string, id: number) {
    const { state } = this.get(accountId, id)
    if (state !== 'running' && state !== 'paused') return
    this.repo.setState(id, 'cancelled')
    this.repo.skipPending(id)
    this.changed(accountId)
  }

  private get(accountId: string, id: number) {
    const send = this.repo.send(accountId, id)
    if (!send) throw new HTTPException(404, { message: NOT_FOUND })
    return send
  }

  // every picked id must still be a friend: the run sends to exactly who was ticked, or nobody
  private fill(accountId: string, body: string, userIds: string[]) {
    const friends = this.repo.friends(accountId, userIds)
    if (friends.length !== new Set(userIds).size) throw new HTTPException(400, { message: 'Có người nhận không còn trong danh sách bạn bè hoặc đã bị chặn, hãy chọn lại' })
    const me = this.repo.accountName(accountId)
    return friends.map((friend) => {
      const values = valuesOf(friend, me)
      return { friend, text: render(body, values), lacks: missingIn(body, values) }
    })
  }

  // One loop per run; pause and cancel take effect at its next turn (after the send in flight or the gap).
  private async loop(id: number) {
    if (this.looping.has(id)) return
    this.looping.add(id)
    try {
      let fails = 0
      for (;;) {
        const next = this.repo.next(id)
        if (!next) {
          // nobody left in line, or the run was paused / cancelled meanwhile
          const run = this.repo.state(id)
          if (run?.state === 'running') this.repo.setState(id, 'done'), this.changed(run.accountId)
          return
        }
        const { accountId, userId, text } = next
        try {
          this.zca.get(accountId)
        } catch (e) {
          // not connected: pause without spending anyone
          this.repo.setState(id, 'paused', describe(e))
          return this.changed(accountId)
        }
        this.repo.mark(id, userId, 'sending')
        try {
          const { msgId } = await this.messages.sendText(accountId, userId, { text })
          this.repo.mark(id, userId, 'sent', { msgId, sentAt: Date.now() })
          fails = 0
        } catch (e) {
          this.repo.mark(id, userId, notSent(e) ? 'failed' : 'unknown', { error: describe(e) })
          if (++fails >= MAX_FAILS) {
            this.repo.setState(id, 'paused', `Dừng vì lỗi ${MAX_FAILS} lần liên tiếp: ${describe(e)}`)
            return this.changed(accountId)
          }
        }
        this.changed(accountId)
        if (this.repo.next(id)) await this.sleep(this.gap())
      }
    } finally {
      this.looping.delete(id)
    }
  }

  private changed(accountId: string) {
    broadcast({ type: 'bulk_sends', accountId })
  }
}
