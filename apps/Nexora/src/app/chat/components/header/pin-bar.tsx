import { useState } from "react";
import type { Pin } from "@/shared/types";
import { RichText } from "@/app/chat/components/message/rich-text";
import { MessageSquareTextIcon } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

// Zalo's msg_type codes inside a pinned message
const PINNED_TYPE: Record<number, string> = {
  31: "[Tin nhắn thoại]",
  32: "[Hình ảnh]",
  36: "[Sticker]",
  37: "[Vẽ hình]",
  38: "[Danh thiếp]",
  43: "[Vị trí]",
  44: "[Video]",
  46: "[File]",
  49: "[GIF]",
};
// board topics that aren't messages (notes, polls, reminders)
const TOPIC = ["Ghi chú", "Link", "Tin nhắn", "Bình chọn", "Nhắc hẹn"];

const pinText = (p: Pin) => (p.msgType === 1 || !p.msgType ? p.title : p.title ? `${PINNED_TYPE[p.msgType] ?? ""} ${p.title}` : (PINNED_TYPE[p.msgType] ?? "")) || TOPIC[p.topicType] || "";

// Zalo PC's pin banner on top of a conversation: the first pin and "+N ghim", or the whole "Danh sách ghim (N)"
export function PinBar({ pins, onJump, onUnpin }: { pins: Pin[]; onJump: (msgId: string) => void; onUnpin: (p: Pin) => void }) {
  const [open, setOpen] = useState(false);
  if (!pins.length) return null;
  const shown = open ? pins : pins.slice(0, 1);
  return (
    <div className="border-t border-black/5 px-4 py-1.5">
      {open && (
        <div className="flex items-center justify-between pb-1 text-xs font-semibold">
          Danh sách ghim ({pins.length})
          <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>
            Thu gọn
          </Button>
        </div>
      )}
      {shown.map((p) => (
        <div key={p.topicId} className="flex items-center gap-2 py-0.5">
          <MessageSquareTextIcon className="size-4 shrink-0 text-primary" />
          <button className="min-w-0 flex-1 text-left" disabled={!p.msgId} onClick={() => p.msgId && onJump(p.msgId)}>
            <div className="truncate text-xs font-semibold">{p.senderName ? `Tin nhắn của ${p.senderName}` : "Tin nhắn được ghim"}</div>
            <div className="truncate text-xs text-muted-foreground">
              <RichText text={pinText(p)} />
            </div>
          </button>
          {!open && pins.length > 1 ? (
            <Button variant="outline" size="xs" className="bg-white/60" onClick={() => setOpen(true)}>
              +{pins.length - 1} ghim
            </Button>
          ) : (
            <Button variant="ghost" size="xs" onClick={() => onUnpin(p)}>
              Bỏ ghim
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
