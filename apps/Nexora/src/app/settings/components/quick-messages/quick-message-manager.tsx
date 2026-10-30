import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import type { QuickMessage } from "@/shared/types";
import { Confirm } from "@/shared/components/dialogs/confirm-dialog";
import type { Ask } from "@/shared/models/dialog.model";
import { MUTED } from "@/app/settings/constants/quick-message.constants";
import { QuickMessageForm } from "@/app/settings/components/quick-messages/quick-message-form";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils/shadcn";

// Zalo PC "Quản lý tin nhắn nhanh": the list, newest first, with create / edit / delete
export function QuickMessageManager({ accountId }: { accountId: string }) {
  const [data, setData] = useState<{ items: QuickMessage[]; max: number }>();
  const [editing, setEditing] = useState<QuickMessage | "new">();
  const [ask, setAsk] = useState<Ask>();
  const [note, setNote] = useState<{ text: string; error?: boolean }>();
  const base = `/accounts/${accountId}/quick-messages`;
  const load = () => api<{ items: QuickMessage[]; max: number }>(base).then(setData, (e) => setNote({ text: e.message, error: true }));
  useEffect(() => {
    load();
    return onEvent((e) => e.type === "quick_messages" && e.accountId === accountId && load());
  }, [accountId]);

  if (!data) return <p className={MUTED}>{note?.text ?? "Đang tải dữ liệu"}</p>;
  const full = data.items.length >= data.max;
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-semibold">
          Tin nhắn nhanh ({data.items.length}/{data.max})
        </span>
        <Button
          onClick={() =>
            full ? setNote({ text: `Đạt giới hạn ${data.max} tin nhắn nhanh. Vui lòng xóa tin nhắn cũ để cập nhật tin nhắn mới`, error: true }) : setEditing("new")
          }
        >
          Tạo mới
        </Button>
      </div>
      {note && <p className={cn("mb-3 text-xs", note.error ? "text-red-600" : "text-green-700")}>{note.text}</p>}
      {data.items.map((q) => (
        <div key={q.id} className="group/row flex items-center gap-3 rounded-lg p-2 hover:bg-muted">
          {q.photo && <img className="size-10 rounded object-cover" src={q.photo} alt="" />}
          <div className="min-w-0 flex-1">
            <div className="font-medium">/{q.keyword}</div>
            <div className={cn(MUTED, "line-clamp-2 whitespace-pre-wrap")}>{q.title}</div>
          </div>
          <div className="invisible flex gap-1.5 group-hover/row:visible">
            <Button variant="outline" onClick={() => setEditing(q)}>
              Chỉnh sửa
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setAsk({
                  title: "Xác nhận",
                  message: "Tin nhắn sẽ được xóa và không thể phục hồi. Bạn có chắc chắn muốn xóa?",
                  ok: "Xóa",
                  run: () => api(`${base}/${q.id}`, "DELETE").then(() => (setNote({ text: "Đã xóa thành công" }), load())),
                })
              }
            >
              Xóa
            </Button>
          </div>
        </div>
      ))}
      {editing && (
        <QuickMessageForm
          item={editing === "new" ? undefined : editing}
          onSave={(body) =>
            api(editing === "new" ? base : `${base}/${editing.id}`, editing === "new" ? "POST" : "PUT", body).then(() => {
              setNote({ text: editing === "new" ? "Tạo tin nhắn nhanh thành công" : "Chỉnh sửa tin nhắn nhanh thành công" });
              setEditing(undefined);
              load();
            })
          }
          onClose={() => setEditing(undefined)}
        />
      )}
      {ask && <Confirm ask={ask} onClose={() => setAsk(undefined)} />}
    </>
  );
}
