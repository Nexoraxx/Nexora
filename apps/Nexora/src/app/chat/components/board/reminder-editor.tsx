import { useState } from "react";
import { api } from "@/core/http/api";
import type { Reminder } from "@/shared/types";
import { toLocal } from "@/app/chat/utils/board.utils";
import { useAction } from "@/app/chat/hooks/useAction";
import { MAX_TEXT, REPEAT } from "@/app/chat/constants/board.constants";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";

const tomorrow9 = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.setHours(9, 0, 0, 0);
};

// "Tạo nhắc hẹn" / "Chỉnh sửa nhắc hẹn", groups and 1-1; base is the thread's
export function ReminderEditor({ base, isGroup, reminder, onClose }: { base: string; isGroup: boolean; reminder?: Reminder; onClose: () => void }) {
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [at, setAt] = useState(toLocal(reminder?.startTime ?? Date.now() + 15 * 60_000));
  const [repeat, setRepeat] = useState(reminder?.repeat ?? 0);
  const { busy, error, act } = useAction();
  const url = reminder ? `${base}/reminders/${reminder.id}` : `${base}/reminders`;
  const save = () => act(() => api(url, reminder ? "PUT" : "POST", { isGroup, title, startTime: new Date(at).getTime(), repeat }), onClose);
  const quick: [string, () => number][] = [
    ["15 phút nữa", () => Date.now() + 15 * 60_000],
    ["30 phút nữa", () => Date.now() + 30 * 60_000],
    ["9:00 ngày mai", tomorrow9],
  ];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[440px]">
        <DialogTitle>{reminder ? "Chỉnh sửa nhắc hẹn" : "Tạo nhắc hẹn"}</DialogTitle>
        <Textarea autoFocus rows={3} maxLength={MAX_TEXT} placeholder="Nhập nội dung mới hoặc link" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex flex-col gap-1.5 text-sm">
          Chọn thời gian
          <div className="flex flex-wrap gap-1.5">
            {quick.map(([label, time]) => (
              <Button key={label} variant="outline" size="sm" onClick={() => setAt(toLocal(time()))}>
                {label}
              </Button>
            ))}
          </div>
          <Input type="datetime-local" min={toLocal(Date.now())} value={at} onChange={(e) => setAt(e.target.value)} />
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Lặp lại
          <select className="h-8 rounded-md border bg-background px-2" value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
            {REPEAT.map((label, i) => (
              <option key={i} value={i}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <DialogFooter>
          {reminder && (
            <Button variant="destructive" className="mr-auto" disabled={busy} onClick={() => act(() => api(`${url}?isGroup=${isGroup}`, "DELETE"), onClose)}>
              Xóa nhắc hẹn
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={busy || !title.trim() || !at} onClick={save}>
            {reminder ? "Lưu chỉnh sửa" : "Tạo nhắc hẹn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
