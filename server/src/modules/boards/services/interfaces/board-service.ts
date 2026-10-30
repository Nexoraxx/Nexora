import type { CreatePollRequest, NoteRequest, ReminderRequest, VoteRequest } from '../../dtos/requests/board.request'
import type { BoardItem, Poll, Reminder } from '../../dtos/responses/board.response'

export default interface IBoardService {
  board(accountId: string, groupId: string): Promise<BoardItem[]>
  createPoll(accountId: string, groupId: string, r: CreatePollRequest): Promise<{ pollId: string }>
  poll(accountId: string, groupId: string, pollId: string): Promise<Poll>
  vote(accountId: string, groupId: string, pollId: string, body: VoteRequest): Promise<Poll>
  lockPoll(accountId: string, groupId: string, pollId: string): Promise<void>
  createNote(accountId: string, groupId: string, body: NoteRequest): Promise<void>
  editNote(accountId: string, groupId: string, topicId: string, body: NoteRequest): Promise<void>
  removeTopic(accountId: string, threadId: string, topicId: string, isGroup: boolean): Promise<void>
  reminders(accountId: string, threadId: string, isGroup: boolean): Promise<Reminder[]>
  createReminder(accountId: string, threadId: string, body: ReminderRequest): Promise<void>
  editReminder(accountId: string, threadId: string, topicId: string, body: ReminderRequest): Promise<void>
  respond(accountId: string, groupId: string, reminderId: string, accept: boolean): Promise<void>
}
