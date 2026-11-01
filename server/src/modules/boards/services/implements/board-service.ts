import { inject, injectable } from 'inversify'
import { BoardType, ReminderResponseStatus, type NoteDetail, type PollDetail } from '@hwqnq/zca-js'
import { broadcast } from '../../../../core'
import { ZcaService } from '../../../../third-party/zalo/zalo-client'
import { zaloPost } from '../../../../third-party/zalo/post'
import type { CreatePollRequest, NoteRequest, ReminderRequest, VoteRequest } from '../../dtos/requests/board.request'
import { TOKENS } from '../../../../di/tokens'
import type { Poll, BoardItem, Reminder } from '../../dtos/responses/board.response'
import type IBoardRepository from '../../repositories/interfaces/board-repository'
import type IBoardService from '../interfaces/board-service'
import { CHAT_BAR, REMINDER_EMOJI, PAGE, BOARD_EVENTS, ERRORS } from '../../constants/board.constant'
import { type } from '../../helpers/board.helper'
import { explain } from '../../../../core/extensions/exceptions'

// Zalo PC's "Bảng tin": polls ("Tạo bình chọn"), notes ("Tạo ghi chú") and reminders ("Tạo nhắc hẹn", groups and
// 1-1). Changes from anyone arrive as group events and go out on /events as "board"; poll votes come as
// group.poll messages, which the open poll reloads on.
@injectable()
export default class BoardService implements IBoardService {
  constructor(
    @inject(TOKENS.BoardRepository) private boards: IBoardRepository,
    @inject(ZcaService) private zca: ZcaService,
  ) {
    zca.on('group_event', (accountId, e) => {
      if (BOARD_EVENTS.has(e.type)) broadcast({ type: 'board', accountId, threadId: e.threadId })
    })
  }

  // notes and polls of the group's board; pinned messages live in the pin bar, reminders in their own list
  async board(accountId: string, groupId: string): Promise<BoardItem[]> {
    const { items } = await this.zca.get(accountId).getListBoard(PAGE, groupId).catch(explain(ERRORS))
    return (items ?? []).flatMap((i): BoardItem[] => {
      if (i.boardType === BoardType.Poll) {
        const p = i.data as PollDetail
        return [{ kind: 'poll', id: String(p.poll_id), title: p.question, creatorId: p.creator, time: p.created_time, closed: p.closed }]
      }
      const n = i.data as NoteDetail
      // a topic with a start time is a reminder
      if (i.boardType !== BoardType.Note || n.startTime > 0) return []
      return [{ kind: 'note', id: n.id, title: n.params?.title ?? '', creatorId: n.creatorId, time: n.editTime || n.createTime }]
    })
  }

  // PC's createPollRequestData: options trimmed and deduplicated, adding options off while results are hidden
  async createPoll(accountId: string, groupId: string, r: CreatePollRequest) {
    const api = this.zca.get(accountId)
    const poll = await zaloPost<PollDetail>(api, 'group_poll', '/api/poll/create', {
      group_id: groupId,
      question: r.question,
      options: r.options,
      expired_time: r.expiredTime,
      pinAct: r.pin,
      allow_multi_choices: r.allowMultiChoices,
      allow_add_new_option: r.allowAddNewOption && !r.hideVotePreview,
      is_hide_vote_preview: r.hideVotePreview,
      is_anonymous: r.isAnonymous,
      poll_type: 0,
      src: CHAT_BAR,
      imei: api.getContext().imei,
    }).catch(explain(ERRORS))
    // ponytail: PC also pins with a second board-pin call after create; pinAct alone is trusted here, add the call
    // if pinned polls don't show up
    broadcast({ type: 'board', accountId, threadId: groupId })
    return { pollId: String(poll.poll_id) }
  }

  async poll(accountId: string, groupId: string, pollId: string): Promise<Poll> {
    return this.view(accountId, groupId, await this.zca.get(accountId).getPollDetail(Number(pollId)).catch(explain(ERRORS)))
  }

  // PC adds new options instead of voting whenever there are some, voting for them at once
  async vote(accountId: string, groupId: string, pollId: string, { optionIds, newOptions }: VoteRequest) {
    const api = this.zca.get(accountId)
    await (newOptions.length
      ? api.addPollOptions({ pollId: Number(pollId), options: newOptions.map((content) => ({ content, voted: true })), votedOptionIds: optionIds })
      : api.votePoll(Number(pollId), optionIds)
    ).catch(explain(ERRORS))
    return this.poll(accountId, groupId, pollId)
  }

  async lockPoll(accountId: string, groupId: string, pollId: string) {
    await this.zca.get(accountId).lockPoll(Number(pollId)).catch(explain(ERRORS))
    broadcast({ type: 'board', accountId, threadId: groupId })
  }

  // zca's createNote / editNote send what PC does; edits leave the pin alone unless pinning (pinAct 2 / 1)
  async createNote(accountId: string, groupId: string, { title, pin }: NoteRequest) {
    await this.zca.get(accountId).createNote({ title, pinAct: pin }, groupId).catch(explain(ERRORS))
    broadcast({ type: 'board', accountId, threadId: groupId })
  }

  async editNote(accountId: string, groupId: string, topicId: string, { title, pin }: NoteRequest) {
    await this.zca.get(accountId).editNote({ title, topicId, pinAct: pin }, groupId).catch(explain(ERRORS))
    broadcast({ type: 'board', accountId, threadId: groupId })
  }

  // a note or a group reminder: both are board topics
  async removeTopic(accountId: string, threadId: string, topicId: string, isGroup: boolean) {
    await this.zca.get(accountId).removeReminder(topicId, threadId, type(isGroup)).catch(explain(ERRORS))
    broadcast({ type: 'board', accountId, threadId })
  }

  async reminders(accountId: string, threadId: string, isGroup: boolean): Promise<Reminder[]> {
    const list = await this.zca.get(accountId).getListReminder(PAGE, threadId, type(isGroup)).catch(explain(ERRORS))
    return (list ?? []).map((r) => ({
      id: String(r.id ?? r.reminderId),
      title: r.params?.title ?? '',
      startTime: r.startTime,
      repeat: r.repeat,
      creatorId: String(r.creatorId ?? r.creatorUid),
      ...(isGroup && { accepted: r.responseMem?.acceptMember ?? 0, rejected: r.responseMem?.rejectMember ?? 0, myResponse: r.responseMem?.myResp ?? 0 }),
    }))
  }

  // PC keeps ⏰ on edits too (zca would clear it)
  async createReminder(accountId: string, threadId: string, { isGroup, title, startTime, repeat }: ReminderRequest) {
    await this.zca.get(accountId).createReminder({ title, startTime, repeat, emoji: REMINDER_EMOJI }, threadId, type(isGroup)).catch(explain(ERRORS))
    broadcast({ type: 'board', accountId, threadId })
  }

  async editReminder(accountId: string, threadId: string, topicId: string, { isGroup, title, startTime, repeat }: ReminderRequest) {
    await this.zca.get(accountId).editReminder({ title, topicId, startTime, repeat, emoji: REMINDER_EMOJI }, threadId, type(isGroup)).catch(explain(ERRORS))
    broadcast({ type: 'board', accountId, threadId })
  }

  async respond(accountId: string, groupId: string, reminderId: string, accept: boolean) {
    await this.zca.get(accountId).respondReminder(groupId, reminderId, accept ? ReminderResponseStatus.Accept : ReminderResponseStatus.Reject).catch(explain(ERRORS))
    broadcast({ type: 'board', accountId, threadId: groupId })
  }

  private view(accountId: string, groupId: string, d: PollDetail): Poll {
    const ids = [...new Set([d.creator, ...d.options.flatMap((o) => o.voters ?? [])])]
    const people = new Map(this.boards.people(accountId, ids).map((p) => [p.userId, p]))
    const group = this.boards.group(accountId, groupId)
    const admin = group?.creatorId === accountId || (JSON.parse(group?.adminIds ?? '[]') as string[]).includes(accountId)
    const hideResults = d.is_hide_vote_preview && !d.joined && !d.closed
    const hideVoters = d.is_anonymous || hideResults
    return {
      pollId: String(d.poll_id),
      question: d.question,
      creatorId: d.creator,
      creatorName: people.get(d.creator)?.name ?? d.creator,
      closed: d.closed,
      expiredTime: d.expired_time,
      multi: d.allow_multi_choices,
      canAddOption: d.allow_add_new_option && !d.closed,
      anonymous: d.is_anonymous,
      hideResults,
      numVote: d.num_vote || new Set(d.options.flatMap((o) => o.voters ?? [])).size,
      options: d.options.map((o) => ({
        id: o.option_id,
        content: o.content,
        votes: hideResults ? null : o.votes,
        mine: o.voted || (o.voters ?? []).includes(accountId),
        voters: hideVoters ? null : (o.voters ?? []).map((id) => people.get(id) ?? { userId: id, name: id, avatar: '' }),
      })),
      canLock: !d.closed && (d.creator === accountId || admin),
    }
  }
}
