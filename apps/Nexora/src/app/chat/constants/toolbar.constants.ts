import {
  AlarmClockIcon,
  BookUserIcon,
  ContactIcon,
  CopyIcon,
  ForwardIcon,
  ListChecksIcon,
  ListTodoIcon,
  MessageCircleIcon,
  PaperclipIcon,
  PinIcon,
  SendIcon,
  ReplyIcon,
  SmileIcon,
  SmilePlusIcon,
  StarIcon,
  StickerIcon,
  StickyNoteIcon,
  TypeIcon,
} from "lucide-react";
import type { Tool } from "@/shared/hooks/use-toolbar";

// the top bar's views; "Tin nhắn" can't be hidden, it's the way back to the conversations
export const VIEW_BAR = "views";
export const VIEW_TOOLS: Tool[] = [
  { id: "chat", label: "Tin nhắn", icon: MessageCircleIcon, place: "bar", places: ["bar", "menu"] },
  { id: "contacts", label: "Danh bạ", icon: BookUserIcon, place: "bar" },
  { id: "bulk", label: "Gửi hàng loạt", icon: SendIcon, place: "bar" },
  { id: "todos", label: "Công việc", icon: ListTodoIcon, place: "bar" },
  { id: "starred", label: "Tin đánh dấu", icon: StarIcon, place: "menu" },
];

// the tools under the message box, in their default order and place
export const COMPOSER_BAR = "composer";
export const COMPOSER_TOOLS: Tool[] = [
  { id: "file", label: "Gửi ảnh / file", icon: PaperclipIcon, place: "bar" },
  { id: "emoji", label: "Biểu tượng cảm xúc", icon: SmileIcon, place: "bar" },
  { id: "sticker", label: "Sticker", icon: StickerIcon, place: "bar" },
  { id: "card", label: "Gửi danh thiếp", icon: ContactIcon, place: "bar" },
  { id: "format", label: "Định dạng tin nhắn", icon: TypeIcon, place: "bar" },
  { id: "poll", label: "Tạo bình chọn", icon: ListChecksIcon, place: "menu" },
  { id: "note", label: "Tạo ghi chú", icon: StickyNoteIcon, place: "menu" },
  { id: "reminder", label: "Tạo nhắc hẹn", icon: AlarmClockIcon, place: "menu" },
];
// shown in groups only
export const GROUP_ONLY = new Set(["poll", "note"]);

// the bar over a hovered message; the rest of its "…" menu stays fixed
export const MESSAGE_BAR = "message";
export const MESSAGE_TOOLS: Tool[] = [
  { id: "react", label: "Thả cảm xúc nhanh", icon: SmilePlusIcon, place: "bar" },
  { id: "reply", label: "Trả lời", icon: ReplyIcon, place: "bar" },
  { id: "forward", label: "Chia sẻ", icon: ForwardIcon, place: "bar" },
  { id: "copy", label: "Sao chép", icon: CopyIcon, place: "menu" },
  { id: "pin", label: "Ghim tin nhắn", icon: PinIcon, place: "menu" },
  { id: "star", label: "Đánh dấu tin nhắn", icon: StarIcon, place: "menu" },
];
