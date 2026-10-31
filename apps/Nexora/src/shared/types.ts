import type { Mention } from "@/shared/models/text.model";

export type AccountStatus = "connecting" | "online" | "offline" | "kicked";
export type Account = { id: string; name: string; avatar: string | null; status: AccountStatus; state: "active" | "locked" | "retired" };
export type Friend = { userId: string; displayName: string; zaloName: string; alias: string | null; avatar: string; phoneNumber: string; status: string | null; isBlocked: number | null };
// friendRequestType: 1 = suggestion, 2 = received request
export type FriendRequest = { userId: string; displayName: string; zaloName: string; avatar: string; friendRequestType: number; friendRequestMsg: string | null; friendRequestFetchTime: number | null; friendRequestRead: number | null };
export type SentRequest = { userId: string; displayName: string; avatar: string; fReqInfo: { message: string; time: number } };
export type Group = { userId: string; displayName: string; avatar: string; totalMember: number };
export type FoundUser = { userId: string; displayName: string; zaloName: string; avatar: string; isFr: number };
// "Danh sách chặn"; name = alias, display name or Zalo name
export type BlockedUser = { userId: string; name: string; avatar: string };

export type ReactionCount = { icon: string; count: number; mine: boolean };
export type MessageRow = {
  accountId: string;
  threadId: string;
  msgId: string;
  cliMsgId: string | null;
  fromUid: string | null;
  dName: string | null;
  // 'webchat', 'chat.photo', 'chat.sticker', 'share.file', 'chat.recommended', ...; 'chat.undo' once recalled;
  // GROUP_NOTI for group events (fromUid null)
  msgType: string;
  sendDttm: number;
  content: unknown;
  quote: { ownerId?: string; msg?: string; fromD?: string; attach?: string } | null;
  mentions: Mention[] | null;
  // "Tin nhắn tự xóa": ms after sendDttm
  ttl: number | null;
  // "Đánh dấu tin nhắn" (local)
  starred: boolean;
  reactions: ReactionCount[];
  seenUids: string[];
  deliveredUids: string[];
  // end-to-end encrypted message: Zalo PC's state (3000 decrypted, 3001 failed, 3003 sent to an older key)
  e2eeStatus: number | null;
};

export type Thread = {
  threadId: string;
  isGroup: boolean;
  name: string | null;
  avatar: string | null;
  msgId: string;
  msgType: string;
  content: unknown;
  fromUid: string | null;
  dName: string | null;
  messageTime: number;
  unread: number;
  // end-to-end encrypted conversation
  e2ee: boolean;
};
// Zalo profile ("Thông tin tài khoản"); sdob is already cut down by the owner's birthday privacy, gender 0 = Nam, 1 = Nữ
export type Profile = { userId: string; displayName: string; zaloName: string; avatar: string; cover: string; status: string; gender: number | null; sdob: string; phoneNumber: string | null };
export type OwnProfile = Profile & { dob: number };
export type UserProfile = Profile & {
  alias: string | null;
  isFr: boolean;
  isBlocked: boolean;
  request: "received" | "sent" | null;
  mutualGroups: { groupId: string; name: string; avatar: string }[];
};
// "Phân loại": a conversation sits in at most one label
export type Label = { id: number; text: string; color: string; emoji: string; conversations: string[] };
// pinned / muted threads ("Ghim hội thoại", "Tắt thông báo"); muted maps thread → until (ms) or -1 = until turned back on;
// ttl maps threads with "Tin nhắn tự xóa" on → ms; unread: "Đánh dấu chưa đọc"; archived: in "Khác"; hidden: "Ẩn trò chuyện"
export type ConversationSettings = {
  pinned: string[];
  muted: Record<string, number>;
  ttl: Record<string, number>;
  unread: string[];
  archived: string[];
  labels: Label[];
  hidden: string[];
  hasPin: boolean;
};

export type GroupMember = { userId: string; name: string; avatar: string; role: "owner" | "admin" | null; isFr: boolean };
// the group's switches (PC "Quản lý nhóm"), 1 = on
export type GroupSetting = {
  blockName?: number;
  setTopicOnly?: number;
  lockCreatePost?: number;
  lockCreatePoll?: number;
  lockSendMsg?: number;
  lockViewMember?: number;
  joinAppr?: number;
  signAdminMsg?: number;
  enableMsgHistory?: number;
};
// locked: the group hides its member list from this account, so members holds only owner, deputies and self;
// pending: join requests waiting for approval (owner and deputies only)
export type GroupDetails = {
  groupId: string;
  name: string;
  avatar: string;
  desc: string;
  totalMember: number;
  canEdit: boolean;
  locked: boolean;
  setting: GroupSetting;
  pending: number;
  members: GroupMember[];
};
export type GroupLink = { link: string | null; enabled: boolean; expiration: number | null };
// the group behind a join link
export type LinkGroup = { groupId: string; name: string; avatar: string; desc: string; totalMember: number; isMember: boolean };
// "Lời mời vào nhóm"; expiredTs ms
export type GroupInvitation = { groupId: string; name: string; avatar: string; totalMember: number; inviterName: string; inviterAvatar: string; expiredTs: number };
// pending join requests and blocked members
export type GroupPerson = { userId: string; name: string; avatar: string };
// votes / voters null while hidden ("Ẩn kết quả khi chưa bình chọn", "Ẩn người bình chọn")
export type PollOption = { id: number; content: string; votes: number | null; mine: boolean; voters: GroupPerson[] | null };
export type Poll = {
  pollId: string;
  question: string;
  creatorId: string;
  creatorName: string;
  closed: boolean;
  expiredTime: number;
  multi: boolean;
  canAddOption: boolean;
  anonymous: boolean;
  hideResults: boolean;
  numVote: number;
  options: PollOption[];
  canLock: boolean;
};
// a note or poll of a group's "Bảng tin"
export type BoardItem = { kind: "note" | "poll"; id: string; title: string; creatorId: string; time: number; closed?: boolean };
// repeat 0 none, 1 daily, 2 weekly, 3 monthly; groups: RSVP counts and own answer (0 none, 1 accept, 2 reject)
export type Reminder = { id: string; title: string; startTime: number; repeat: number; creatorId: string; accepted?: number; rejected?: number; myResponse?: number };
export type MediaItem = { msgId: string; msgType: string; content: unknown; sendDttm: number };
export type AvatarPhoto = { photoId: string; thumbnail: string; url: string };
// msgId: jump to that message on open (pins, search, "Tin đánh dấu")
// accountId: the account to chat as, set when opened from "Tất cả"; otherwise the open account
export type ChatTarget = { threadId: string; isGroup: boolean; name: string | null; avatar: string | null; msgId?: string; accountId?: string };
// anim.frames > 1: horizontal sprite strip (duration ms per frame); 1: anim.url is itself animated (webp/gif)
export type Sticker = { id: number; cateId: number; type: number; text: string; thumb: string; anim: { url: string; frames: number; duration: number } | null };
export type StickerCategory = { id: number; name: string; iconUrl: string; totalImage: number; added?: boolean };

export type ServerEvent =
  | { type: "qr"; image: string }
  | { type: "qr-scanned"; name: string; avatar: string }
  | { type: "qr-failed" }
  | { type: "qr-done"; id: string }
  | { type: "account"; id: string; status: AccountStatus }
  | { type: "profile"; id: string; name: string; avatar: string | null }
  | { type: "contacts"; accountId: string }
  | { type: "message"; message: MessageRow }
  | { type: "undo"; accountId: string; msgId: string }
  | { type: "reaction"; accountId: string; threadId: string; msgId: string; reactions: ReactionCount[] }
  | { type: "threads"; accountId: string }
  | { type: "conversations"; accountId: string }
  | { type: "group"; accountId: string; groupId: string }
  | { type: "receipt"; accountId: string; threadId: string }
  | { type: "typing"; accountId: string; threadId: string; userId: string; name: string | null }
  | { type: "pins"; accountId: string; threadId: string }
  | { type: "board"; accountId: string; threadId: string }
  | { type: "settings"; accountId: string }
  | { type: "quick_messages"; accountId: string }
  | { type: "auto_replies"; accountId: string }
  | { type: "todos"; accountId: string }
  // a "Gửi hàng loạt" run started, moved on or changed state
  | { type: "bulk_sends"; accountId: string };

// a pinned topic of the pin bar; msgId set when it pins a message, msgType is Zalo's numeric code (1 text, 32 photo, ...)
export type Pin = {
  topicId: string;
  topicType: number;
  msgId: string | null;
  cliMsgId: string | null;
  senderUid: string | null;
  senderName: string | null;
  title: string;
  msgType: number | null;
  thumb: string | null;
  createTime: number | null;
};
export type Pins = { pins: Pin[]; limit: number };
export type MessagePerson = { userId: string; name: string; avatar: string };
// "Thông tin tin nhắn"; hidden = group over maxMembers, PC lists nobody
export type MessageInfo = { seen: MessagePerson[]; delivered: MessagePerson[]; hidden: boolean; maxMembers: number };
export type LinkPreview = { href: string; title: string; desc: string; thumb: string; src: string; media: { type?: number } | null };
// url = original, thumb = what the bubble shows
export type Gif = { id: string; url: string; thumb: string; width: number; height: number };

// "Cloud của tôi" (PC's send-to-me): its own conversation id (null before Zalo gives one) and Zalo's name for it
export type MyCloud = { threadId: string | null; name: string };
// the account's own settings (/api/setting/me), booleans as 1 / 0
export type Settings = Record<string, number>;
// "Tin nhắn nhanh"; photo = the item's picture (PC items may carry one)
export type QuickMessage = { id: string; keyword: string; title: string; photo: string | null; lastModified: number };
// "Trả lời tự động": startTime / endTime ms (a daily window), scope 0 everyone, 1 strangers, 2 only uids, 3 all but uids
export type AutoReply = { id: number; enable: boolean; content: string; startTime: number; endTime: number; scope: number; uids: string[] };
// enabled: the zBusiness package allows it; limits on rules and active rules
export type AutoReplies = { enabled: boolean; maxRules: number; maxActive: number; rules: AutoReply[] };
