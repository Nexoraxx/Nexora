import { useState } from "react";
import { api } from "@/core/http/api";
import type { Label } from "@/shared/types";
import { CheckIcon } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";

// colors offered for a new "Phân loại"
const LABEL_COLORS = ["#db342e", "#f27806", "#f7b503", "#15a85f", "#0068ff", "#8e44ad", "#e91e63", "#6b7280"];

// Zalo PC "Quản lý thẻ phân loại": up to 15 labels, names up to 60 characters
export function LabelManager({ accountId, labels, onClose }: { accountId: string; labels: Label[]; onClose: () => void }) {
  const [editing, setEditing] = useState<{ id?: number; text: string; color: string }>();
  const [error, setError] = useState<string>();
  const base = `/accounts/${accountId}/labels`;
  const run = (p: Promise<unknown>, then?: () => void) =>
    p.then(() => (setError(undefined), then?.())).catch((e) => setError(e.message));
  const save = () =>
    editing &&
    run(api(editing.id === undefined ? base : `${base}/${editing.id}`, editing.id === undefined ? "POST" : "PUT", { text: editing.text, color: editing.color }), () => setEditing(undefined));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[400px]">
        <DialogTitle>Quản lý thẻ phân loại</DialogTitle>
        <div className="max-h-72 overflow-y-auto">
          {labels.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
              <span className="size-3.5 shrink-0 rounded-sm" style={{ background: l.color }} />
              <span className="flex-1 truncate">{l.text}</span>
              <span className="text-xs text-muted-foreground">{l.conversations.length}</span>
              <Button variant="ghost" size="xs" onClick={() => setEditing({ id: l.id, text: l.text, color: l.color })}>
                Đổi tên
              </Button>
              <Button variant="ghost" size="xs" className="text-destructive" onClick={() => run(api(`${base}/${l.id}`, "DELETE"))}>
                Xoá
              </Button>
            </div>
          ))}
          {!labels.length && <p className="p-2 text-center text-xs text-muted-foreground">Chưa có phân loại</p>}
        </div>
        {editing ? (
          <div className="flex flex-col gap-2">
            <Input autoFocus maxLength={60} placeholder="Tên phân loại mới (60 ký tự)" value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
            <div className="flex gap-1.5">
              {LABEL_COLORS.map((c) => (
                <button key={c} className="flex size-6 items-center justify-center rounded-full" style={{ background: c }} onClick={() => setEditing({ ...editing, color: c })}>
                  {editing.color === c && <CheckIcon className="size-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <DialogFooter>
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(undefined)}>
                Hủy
              </Button>
              <Button disabled={!editing.text.trim()} onClick={save}>
                Lưu
              </Button>
            </>
          ) : (
            <Button onClick={() => setEditing({ text: "", color: LABEL_COLORS[0] })}>Thêm mới thẻ phân loại</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
