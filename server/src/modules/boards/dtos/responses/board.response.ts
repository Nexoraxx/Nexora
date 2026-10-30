export type Person = { userId: string; name: string; avatar: string }
// votes / voters are null while PC hides them: "Ẩn kết quả khi chưa bình chọn" before voting, "Ẩn người bình chọn"
export type PollOption = { id: number; content: string; votes: number | null; mine: boolean; voters: Person[] | null }
export type Poll = {
  pollId: string
  question: string
  creatorId: string
  creatorName: string
  closed: boolean
  expiredTime: number
  multi: boolean
  canAddOption: boolean
  anonymous: boolean
  hideResults: boolean
  numVote: number
  options: PollOption[]
  // creator, owner or deputies end it ("Khóa bình chọn")
  canLock: boolean
}
export type BoardItem = { kind: 'note' | 'poll'; id: string; title: string; creatorId: string; time: number; closed?: boolean }
// accepted / rejected / myResponse: group RSVPs ("Tham gia" / "Từ chối"), myResponse 0 none, 1 accept, 2 reject
export type Reminder = { id: string; title: string; startTime: number; repeat: number; creatorId: string; accepted?: number; rejected?: number; myResponse?: number }
