import type { ConversationSettings, Thread } from "@/shared/types";
import { GROUP_NOTI, E2EE, NO_SETTINGS } from "@/app/chat/constants/chat.constants";

// chat.recommended bubbles that are neither a link, a contact card nor a call log
const RECOMMENDED: Record<string, string> = {
  "recommened.stickerset": "[Bộ sticker]",
};

// chat.recommended call logs; calling / receivecall are only PC's local fallback, the server sends calltime / misscall
export const CALL_LOGS = new Set(["recommened.calltime", "recommened.misscall", "recommened.calling", "recommened.receivecall"]);

const callDuration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  return `${h ? `${h} giờ ` : ""}${Math.floor((sec % 3600) / 60)} phút ${sec % 60} giây`;
};

// Zalo PC's call bubble (r6Qt / 4eSn): params.calltype 1 = video; reason 1 busy, 2 rang out, 3 callee rejected,
// 4/5 caller cancelled. The server sends no isCaller, so PC reads every log as incoming; `caller` (the log's sender
// is the caller) fixes that where the sender is known.
export function callLog(c: Attach, caller?: boolean) {
  const p = params(c) as { calltype?: number; reason?: number; duration?: number; isCaller?: number; isEnableCallback?: number };
  const kind = p.calltype === 1 ? "video" : "thoại";
  const missed = c.action === "recommened.misscall";
  const out = Boolean(p.isCaller ?? caller ?? c.action === "recommened.calling");
  const reason = Number(p.reason ?? 0);
  const title = out
    ? missed && (reason === 4 || reason === 5)
      ? "Bạn đã hủy"
      : missed && reason === 3
        ? "Người nhận từ chối"
        : missed && reason === 1
          ? "Người nhận bận"
          : `Cuộc gọi ${kind} đi`
    : !missed
      ? `Cuộc gọi ${kind} đến`
      : reason === 3
        ? "Bạn đã từ chối"
        : "Bạn bị nhỡ";
  return {
    video: p.calltype === 1,
    out,
    // red title: a call this account missed
    missed: missed && !out && reason !== 3,
    title,
    text: !missed || (out && ![1, 3, 4, 5].includes(reason)) ? callDuration(Number(p.duration ?? 0)) : `Cuộc gọi ${kind}`,
    short: out ? `Cuộc gọi ${kind} đi` : missed && reason !== 3 ? `Cuộc gọi ${kind} nhỡ` : `Cuộc gọi ${kind} đến`,
    callback: !!p.isEnableCallback,
  };
}

// Notes, reminders and other group activity come as webchat whose content.action is "msginfo.actionlist": PC fills
// %N$s in params.msg.vi from params.highLightsV2, people by name and times as dates (getPreviewMsgInfoChat).
// ponytail: the account itself shows under its name where PC says "Bạn"
type Highlight = { type?: number; dpn?: string; ts?: number };
const highlight = (h?: Highlight) =>
  h?.type === 1 && h.ts ? new Date(h.ts).toLocaleString("vi", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }) : (h?.dpn ?? "");
function actionList(c: ReturnType<typeof attach>) {
  const p = params(c) as { msg?: { vi?: string }; highLightsV2?: Highlight[] };
  return p.msg?.vi?.replace(/%(\d+)\$s/g, (_, n) => highlight(p.highLightsV2?.[Number(n) - 1])) || c.title || "";
}

// One-line label used by the thread list, quotes, the reply bar and notifications.
export function summary(msgType: string, content: unknown) {
  const c = attach(content);
  switch (msgType) {
    case "webchat":
      return typeof content === "string" ? content : c.action === "msginfo.actionlist" ? actionList(c) : (c.title ?? "");
    case GROUP_NOTI:
      return String(content ?? "");
    case E2EE:
      return "Tin nhắn được mã hoá đầu cuối";
    case "chat.photo":
      return "[Hình ảnh]";
    case "chat.doodle":
      return "[Vẽ hình]";
    case "chat.location.new":
      return `[Vị trí] ${c.title || c.description || ""}`;
    case "group.poll":
      return `[Bình chọn] ${String(params(c).question ?? c.title ?? "")}`;
    case "chat.ecard":
      return String(params(c).previewTxt || "[Thiệp]");
    case "chat.sticker":
      return "[Sticker]";
    case "chat.gif":
      return "[GIF]";
    case "chat.video.msg":
      return "[Video]";
    case "chat.voice":
      return "[Tin nhắn thoại]";
    case "share.file":
      return `[File] ${c.title ?? ""}`;
    case "chat.recommended":
      if (CALL_LOGS.has(c.action ?? "")) return `[${callLog(c).short}]`;
      return c.action === "recommened.link" ? `[Link] ${c.title || c.href || ""}` : (RECOMMENDED[c.action ?? ""] ?? `[Danh thiếp] ${c.title ?? ""}`);
    case "chat.undo":
      return "Tin nhắn đã được thu hồi";
    default:
      return typeof content === "string" ? content : `[${msgType}]`;
  }
}

export const time = (ms: number) => {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString("vi", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("vi", { day: "2-digit", month: "2-digit" });
};

export const labelOf = (settings: ConversationSettings, threadId: string) => settings.labels.find((l) => l.conversations.includes(threadId));

// the account bar's badge: conversations with unread messages or a mark, muted and hidden ones aside as they don't notify
export const unreadCount = (threads: Thread[] = [], s: ConversationSettings = NO_SETTINGS) =>
  threads.filter((t) => (t.unread > 0 || s.unread.includes(t.threadId)) && !(t.threadId in s.muted) && !s.hidden.includes(t.threadId)).length;

// attachment content of photo / file / link messages
type Attach = { title?: string; description?: string; href?: string; thumb?: string; params?: string; action?: string; id?: number; catId?: number };
export const attach = (content: unknown) => (content && typeof content === "object" ? (content as Attach) : {});
export const params = (c: Attach): Record<string, unknown> => {
  try {
    return JSON.parse(c.params || "{}");
  } catch {
    return {};
  }
};
export const fileSize = (bytes: unknown) => {
  const n = Number(bytes);
  if (!n) return "";
  return n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
};

// "1 giờ", "7 ngày", ... for "Tin nhắn tự xóa"
export const ttlText = (ms: number) => (ms % 86_400_000 === 0 ? `${ms / 86_400_000} ngày` : ms % 3_600_000 === 0 ? `${ms / 3_600_000} giờ` : `${Math.max(1, Math.round(ms / 60_000))} phút`);
