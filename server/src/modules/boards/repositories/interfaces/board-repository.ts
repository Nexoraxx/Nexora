import type { Person } from '../../dtos/responses/board.response'

export default interface IBoardRepository {
  people(accountId: string, ids: string[]): Person[]
  group(accountId: string, groupId: string): { creatorId: string | null; adminIds: string | null } | null
}
