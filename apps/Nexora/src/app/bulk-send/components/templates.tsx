import { useEffect, useState } from "react";
import { PlusIcon } from "lucide-react";
import { api } from "@/core/http/api";
import type { Template } from "@/app/bulk-send/models/bulk-send.model";
import { MUTED } from "@/app/bulk-send/constants/bulk-send.constants";
import { unknownVariables } from "@/app/bulk-send/utils/bulk-send.utils";
import { VariableTextarea } from "@/app/bulk-send/components/variable-textarea";
import { Confirm } from "@/shared/components/dialogs/confirm-dialog";
import type { Ask } from "@/shared/models/dialog.model";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils/shadcn";

type Draft = { id?: number; name: string; body: string };
const BLANK: Draft = { name: "", body: "" };

// "Mẫu tin": Nexora's own templates, shared by every account (not Zalo's "Tin nhắn nhanh", whose apps would show
// the {{variables}} as they are)
export function Templates() {
  const [items, setItems] = useState<Template[]>([]);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [note, setNote] = useState<{ text: string; error?: boolean }>();
  const [ask, setAsk] = useState<Ask>();
  const load = () => api<Template[]>("/bulk-templates").then((list) => (setItems(list), list));
  useEffect(() => {
    load().then((list) => list[0] && setDraft(list[0]), (e) => setNote({ text: e.message, error: true }));
  }, []);

  const save = () =>
    api<{ id: number } | undefined>(draft.id ? `/bulk-templates/${draft.id}` : "/bulk-templates", draft.id ? "PUT" : "POST", { name: draft.name, body: draft.body })
      .then((r) => (r && setDraft((d) => ({ ...d, id: r.id })), setNote({ text: "Đã lưu mẫu" }), load()))
      .catch((e) => setNote({ text: e.message, error: true }));
  const remove = (id: number) =>
    setAsk({
      title: "Xoá mẫu tin?",
      message: "Các đợt đã gửi bằng mẫu này không bị ảnh hưởng.",
      ok: "Xoá",
      run: () => api(`/bulk-templates/${id}`, "DELETE").then(() => (setDraft(BLANK), load())),
    });

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r p-2">
        <Button variant="outline" size="sm" onClick={() => (setDraft(BLANK), setNote(undefined))}>
          <PlusIcon /> Mẫu mới
        </Button>
        {items.map((t) => (
          <button key={t.id} className={cn("rounded-lg px-2.5 py-2 text-left hover:bg-muted", t.id === draft.id && "bg-primary/10")} onClick={() => (setDraft(t), setNote(undefined))}>
            <div className="truncate font-medium">{t.name}</div>
            <div className={cn(MUTED, "truncate")}>{t.body}</div>
          </button>
        ))}
        {!items.length && <p className={cn(MUTED, "p-2 text-center")}>Chưa có mẫu nào</p>}
      </aside>
      <div className="flex max-w-2xl min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div>
          <p className={cn(MUTED, "mb-1")}>Tên mẫu</p>
          <Input maxLength={60} placeholder="Ví dụ: Giục chốt đơn" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div>
          <p className={cn(MUTED, "mb-1")}>Nội dung</p>
          <VariableTextarea value={draft.body} onChange={(body) => setDraft({ ...draft, body })} rows={8} />
        </div>
        {note && <p className={cn("text-xs", note.error ? "text-red-600" : "text-muted-foreground")}>{note.text}</p>}
        <div className="flex justify-end gap-2">
          {draft.id && (
            <Button variant="outline" className="text-destructive" onClick={() => remove(draft.id!)}>
              Xoá
            </Button>
          )}
          <Button disabled={!draft.name.trim() || !draft.body.trim() || unknownVariables(draft.body).length > 0} onClick={save}>
            Lưu
          </Button>
        </div>
      </div>
      {ask && <Confirm ask={ask} onClose={() => setAsk(undefined)} />}
    </div>
  );
}
