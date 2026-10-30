import { useState } from "react";
import { api } from "@/core/http/api";
import type { BoardItem } from "@/shared/types";
import { useAction } from "@/app/chat/hooks/useAction";
import { MAX_TEXT } from "@/app/chat/constants/board.constants";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Textarea } from "@/shared/components/ui/textarea";

// "Tạo ghi chú" / "Sửa ghi chú" (groups); editing can also delete it
export function NoteEditor({ base, note, onClose }: { base: string; note?: BoardItem; onClose: () => void }) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [pin, setPin] = useState(false);
  const { busy, error, act } = useAction();
  const save = () => act(() => api(note ? `${base}/notes/${note.id}` : `${base}/notes`, note ? "PUT" : "POST", { title, pin }), onClose);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[440px]">
        <DialogTitle>{note ? "Sửa ghi chú" : "Tạo ghi chú"}</DialogTitle>
        <Textarea autoFocus rows={6} maxLength={MAX_TEXT} placeholder="Nhập nội dung mới hoặc dán link" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={pin} onCheckedChange={(v) => setPin(v === true)} /> Ghim lên đầu trò chuyện
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <DialogFooter>
          {note && (
            <Button variant="destructive" className="mr-auto" disabled={busy} onClick={() => act(() => api(`${base}/notes/${note.id}`, "DELETE"), onClose)}>
              Xóa ghi chú
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={busy || !title.trim()} onClick={save}>
            {note ? "Lưu" : "Tạo ghi chú"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
