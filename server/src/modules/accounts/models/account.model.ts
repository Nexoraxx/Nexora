import type { Account } from '../dtos/responses/account.response'

export type AccountRow = Omit<Account, 'status'> & { imei: string; cookie: string; userAgent: string; language: string | null }
export type SavedAccount = { id: string; name: string; avatar: string; phoneNumber: string; imei: string; cookie: string; userAgent: string; language: string; now: number }

// business accounts' fields as me-v2 returns them; Zalo PC sends them back on every profile update
export type BizInfo = { biz?: { desc?: string; cate?: number; addr?: string; website?: string; email?: string } }
