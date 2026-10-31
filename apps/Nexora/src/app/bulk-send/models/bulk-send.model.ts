// server: modules/bulk-sends/dtos/responses/bulk-send.response.ts
export type Template = { id: number; name: string; body: string; updatedAt: number };
export type RunState = "running" | "paused" | "done" | "cancelled";
export type RecipientState = "pending" | "sending" | "sent" | "failed" | "unknown" | "skipped";
export type Run = { id: number; accountId: string; name: string; state: RunState; pauseReason: string | null; createdAt: number; total: number; sent: number; failed: number; pending: number };
export type Recipient = { userId: string; name: string; avatar: string; text: string; state: RecipientState; error: string | null; sentAt: number | null };
// missing: per variable the text uses, the userIds without a value for it
export type Preview = { items: { userId: string; name: string; text: string }[]; missing: Record<string, string[]> };
