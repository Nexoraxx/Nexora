import type { ConversationSettings, Thread } from "@/shared/types";
import { GROUP_NOTI, E2EE, NO_SETTINGS } from "@/app/chat/constants/chat.constants";

// chat.recommended bubbles that are neither a link nor a contact card
const RECOMMENDED: Record<string, string> = {
  "recommened.misscall": "[Cuộc gọi nhỡ]",
  "recommened.calling": "[Cuộc gọi đi]",
  "recommened.receivecall": "[Cuộc gọi đến]",
  "recommened.calltime": "[Gọi điện]",
  "recommened.stickerset": "[Bộ sticker]",
};

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
