import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { openDatabase, upsert } from '../../dbs/sqlite'
import type { ZcaService } from '../../third-party/zalo/zalo-client'
import BoardRepository from './repositories/implements/board-repository'
import BoardService from './services/implements/board-service'
import { CreatePollRequest } from './dtos/requests/board.request'

const detail = (over: Record<string, unknown> = {}) => ({
  poll_id: 7,
  creator: 'a',
  question: 'Ăn gì?',
  options: [
    { option_id: 1, content: 'Phở', votes: 2, voted: false, voters: ['a', 'me'] },
    { option_id: 2, content: 'Bún', votes: 0, voted: false, voters: [] },
  ],
  joined: true,
  closed: false,
  allow_multi_choices: true,
  allow_add_new_option: true,
  is_anonymous: false,
  is_hide_vote_preview: false,
  num_vote: 0,
  expired_time: 0,
  ...over,
})

test('polls: PC create payload, hidden results and voters, new options go through addPollOptions', async () => {
  const db = openDatabase(':memory:')
  db.run(`INSERT INTO account (id, name, imei, cookie, userAgent, createdAt) VALUES ('me', 'me', 'i', '[]', 'ua', 1)`)
  upsert(db, 'user', [{ accountId: 'me', userId: 'a', displayName: 'An', alias: 'An béo' }])
  upsert(db, 'groups', [{ accountId: 'me', userId: 'g1', displayName: 'G', creatorId: 'b' }])
  upsert(db, 'group_info', [{ accountId: 'me', userId: 'g1', adminIds: ['me'] }])

  let poll = detail()
  const nexoraPost = mock(async () => ({ poll_id: 7 }))
  const votePoll = mock(async () => ({ options: [] }))
  const addPollOptions = mock(async () => ({ options: [] }))
  const api = {
    zpwServiceMap: { group_poll: ['https://poll'] },
    getContext: () => ({ imei: 'imei' }),
    nexoraPost,
    getPollDetail: async () => poll,
    votePoll,
    addPollOptions,
  }
  const boards = new BoardService(new BoardRepository(db), Object.assign(new EventEmitter(), { get: () => api }) as unknown as ZcaService)

  // options trimmed and deduplicated; adding options is off while results are hidden
  const req = CreatePollRequest.parse({ question: ' Ăn gì? ', options: [' Phở', 'Phở', '', 'Bún'], hideVotePreview: true })
  expect(await boards.createPoll('me', 'g1', req)).toEqual({ pollId: '7' })
  expect((nexoraPost.mock.calls[0] as unknown[])[0]).toMatchObject({
    url: 'https://poll/api/poll/create',
    params: { group_id: 'g1', question: 'Ăn gì?', options: ['Phở', 'Bún'], allow_add_new_option: false, is_hide_vote_preview: true, allow_multi_choices: true, pinAct: false, src: 1, imei: 'imei' },
  })
  expect(() => CreatePollRequest.parse({ question: 'q', options: ['a', 'a'] })).toThrow('Bạn không thể tạo bình chọn ít hơn 2 lựa chọn')

  // deputy may lock; voters under local names; counted from voters when num_vote is 0
  const v = await boards.poll('me', 'g1', '7')
  expect(v).toMatchObject({ pollId: '7', creatorName: 'An béo', canLock: true, numVote: 2, hideResults: false })
  expect(v.options[0]).toMatchObject({ votes: 2, mine: true, voters: [{ userId: 'a', name: 'An béo' }, { userId: 'me' }] })

  // "Ẩn kết quả khi chưa bình chọn" before voting; "Ẩn người bình chọn" always
  poll = detail({ is_hide_vote_preview: true, joined: false })
  expect((await boards.poll('me', 'g1', '7')).options[0]).toMatchObject({ votes: null, voters: null })
  poll = detail({ is_anonymous: true })
  expect((await boards.poll('me', 'g1', '7')).options[0]).toMatchObject({ votes: 2, voters: null })

  await boards.vote('me', 'g1', '7', { optionIds: [2], newOptions: [] })
  expect(votePoll.mock.calls[0]).toEqual([7, [2]] as never)
  await boards.vote('me', 'g1', '7', { optionIds: [1], newOptions: ['Cơm'] })
  expect(addPollOptions.mock.calls[0]).toEqual([{ pollId: 7, options: [{ content: 'Cơm', voted: true }], votedOptionIds: [1] }] as never)
})
