import type { ConversationSettings } from "@/shared/types";

export const QUOTE = "mb-1 rounded border-l-3 border-primary bg-primary/5 px-2 py-0.5 text-xs text-gray-700";

// end-to-end encrypted (Signal) messages, which Nexora can't read: no Signal keys of its own as PC registers
export const E2EE = "chat.e2ee";

export const NO_SETTINGS: ConversationSettings = { pinned: [], muted: {}, ttl: {}, unread: [], archived: [], labels: [], hidden: [], hasPin: false };

// Zalo PC's local system message for group events ("A đã thêm B vào nhóm")
export const GROUP_NOTI = "group.noti";
