import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import { openExternal } from "@/core/tauri/native";
import type { AutoReplies, AutoReply } from "@/shared/types";
import { Confirm } from "@/shared/components/dialogs/confirm-dialog";
import type { Ask } from "@/shared/models/dialog.model";
import { hhmm, windowOf } from "@/app/settings/utils/auto-reply.utils";
import { MUTED } from "@/app/settings/constants/auto-reply.constants";
import { AutoReplyEditor } from "@/app/settings/components/auto-replies/auto-reply-editor";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { cn } from "@/shared/utils/shadcn";

const UPGRADE = "https://business.zbox.vn/nang-cap-business-pro/?utm_source=pc_entry&utm_medium=autoreply";

const SCOPE_CHIP = ["Tất cả mọi người", "Người lạ", "Bạn bè cụ thể", "Bạn bè ngoại trừ"];

const windowText = ({ start, end }: { start: number; end: number }) => (start === end ? "Cả ngày" : `${hhmm(start)} - ${hhmm(end)}${end < start ? " (hôm sau)" : ""}`);

// Zalo PC "Trả lời tự động": Zalo's server sends the replies while a rule is on. Offered where the account's
// zBusiness package allows it; a new rule starts off and is switched on from the list.
export function AutoReplyManager({ accountId }: { accountId: string }) {
  const [data, setData] = useState<AutoReplies>();
  const [editing, setEditing] = useState<AutoReply | "new">();
  const [ask, setAsk] = useState<Ask>();
  const [note, setNote] = useState<{ text: string; error?: boolean }>();
  const base = `/accounts/${accountId}/auto-replies`;
  const load = () => api<AutoReplies>(base).then(setData, (e) => setNote({ text: e.message, error: true }));
  useEffect(() => {
    load();
    return onEvent((e) => e.type === "auto_replies" && e.accountId === accountId && load());
  }, [accountId]);
  const run = (p: Promise<unknown>) => (setNote(undefined), p.then(load, (e) => setNote({ text: e.message, error: true })));

  if (!data) return <p className={MUTED}>{note?.text ?? "Đang tải dữ liệu"}</p>;
  if (!data.enabled)
    return (
      <div className="flex flex-col items-start gap-3">
        <p>Trả lời tự động chỉ dành cho tài khoản zBusiness Pro.</p>
        <Button onClick={() => openExternal(UPGRADE)}>Nâng cấp zBusiness Pro</Button>
      </div>
    );

  return (
    <>
      <p className={cn(MUTED, "mb-3")}>Sau khi bật, tin nhắn trả lời tự động sẽ được gửi như cài đặt, cho đến khi bạn tắt.</p>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-semibold">
          Danh sách trả lời tự động ({data.rules.length}/{data.maxRules})
        </span>
        <Button onClick={() => (data.rules.length >= data.maxRules ? setNote({ text: "Đã đạt số lượng trả lời tự động tối đa", error: true }) : setEditing("new"))}>Tạo mới</Button>
      </div>
      {note && <p className={cn("mb-3 text-xs", note.error ? "text-red-600" : "text-green-700")}>{note.text}</p>}
      {!data.rules.length && <p className={MUTED}>Chưa có tin trả lời tự động nào. Nhấn Tạo mới để tạo tin trả lời tự động.</p>}
      {data.rules.map((r) => (
        <div key={r.id} className="mb-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">{windowText(windowOf(r))}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {SCOPE_CHIP[r.scope]}
              {r.scope >= 2 && ` (${r.uids.length})`}
            </span>
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs">
              <Checkbox checked={r.enable} onCheckedChange={(on) => run(api(`${base}/${r.id}/enable`, "PUT", { enable: !!on }))} /> Bật
            </label>
          </div>
          <p className="my-2 whitespace-pre-wrap">{r.content}</p>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setEditing(r)}>
              Chỉnh sửa
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setAsk({ title: "Xoá tin trả lời tự động", message: "Tin nhắn sẽ được xóa và không thể phục hồi. Bạn có chắc chắn muốn xóa?", ok: "Xóa", run: () => api(`${base}/${r.id}`, "DELETE").then(load) })
              }
            >
              Xóa
            </Button>
          </div>
        </div>
      ))}
      {editing && (
        <AutoReplyEditor
          accountId={accountId}
          rule={editing === "new" ? undefined : editing}
          onSave={(form) =>
            api(editing === "new" ? base : `${base}/${editing.id}`, editing === "new" ? "POST" : "PUT", form).then(() => {
              setNote({ text: editing === "new" ? "Tạo tin nhắn thành công" : "Chỉnh sửa tin nhắn thành công" });
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
