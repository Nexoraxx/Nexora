export type GroupLink = { link: string | null; enabled: boolean; expiration: number | null }
export type PendingMember = { userId: string; name: string; avatar: string }
export type BlockedMember = { userId: string; name: string; avatar: string }
export type LinkGroup = { groupId: string; name: string; avatar: string; desc: string; totalMember: number; isMember: boolean }
export type GroupInvitation = { groupId: string; name: string; avatar: string; totalMember: number; inviterName: string; inviterAvatar: string; expiredTs: number }
