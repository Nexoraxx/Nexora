import type { Person } from './template.model'

export type Friend = Person & { userId: string }
export type Next = { sendId: number; accountId: string; userId: string; text: string }
