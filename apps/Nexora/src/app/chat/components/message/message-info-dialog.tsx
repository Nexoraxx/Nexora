import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import type { MessageInfo, MessageRow, MessagePerson } from "@/shared/types";
import { summary } from "@/app/chat/utils/chat.utils";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { RichText } from "@/app/chat/components/message/rich-text";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";

// Zalo PC "Thông tin tin nhắn" of an own group message: the message, then who has seen / received it, 3 per row
export function MessageInfoDialog({ base, message, onClose }: { base: string; message: MessageRow; onClose: () => void }) {
  const [info, setInfo] = useState<MessageInfo>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<MessageInfo>(`${base}/messages/${message.msgId}/info`)
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, []);

  const people = (title: string, list: MessagePerson[]) => (
    <section>
      <div className="pb-1.5 font-semibold">
        {title} ({list.length})
      </div>
      <div className="grid grid-cols-3 gap-2">
        {list.map((p) => (
          <div key={p.userId} className="flex flex-col items-center gap-1 text-center text-xs">
            <Avatar src={p.avatar} name={p.name} size={40} />
            <span className="line-clamp-2">{p.name}</span>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[380px]">
        <DialogTitle>Thông tin tin nhắn</DialogTitle>
        <div className="rounded-lg bg-blue-100 px-3 py-2">
          <div className="line-clamp-4 break-words">
            <RichText text={summary(message.msgType, message.content)} />
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{new Date(message.sendDttm).toLocaleString("vi")}</div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!info && !error && <p className="text-xs text-muted-foreground">Đang tải…</p>}
        {info && (
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
            {people("Đã xem", info.seen)}
            {people("Đã nhận", info.delivered)}
            {info.hidden && <p className="text-xs text-muted-foreground">(*) Thông tin chi tiết "Đã xem", "Đã nhận" chỉ hiển thị với nhóm không quá {info.maxMembers} người</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
