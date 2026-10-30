import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { api } from "@/core/http/api";
import type { GroupDetails, Thread } from "@/shared/types";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { fold } from "@/shared/utils/text.utils";
import type { TodoPerson } from "@/app/todo/models/todo.model";
import { MUTED } from "@/app/todo/constants/todo.constants";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";

const MAX_CONTENT = 2000;
const MAX_TITLE = 100;

// <input type="datetime-local"> works in local time
const toLocal = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

// PC's default deadline: 17:00 today, the next full hour once that's past
const defaultDue = () => {
  const d = new Date();
  return d.getHours() < 17 ? d.setHours(17, 0, 0, 0) : d.setHours(d.getHours() + 1, 0, 0, 0);
};

// Zalo PC "Giao công việc mới". target presets "Giao tại" (the open chat); message: "Giao việc" on that message, whose
// text is the content and which anchors the todo, so "Nội dung" is hidden and "Giao tại" fixed. Without one the
// server sends the content to "Giao tại" first. Nobody ticked: the todo goes to this account.
// ponytail: no reminders, repeat, watchers or PC's empty-title prompt; add them with the editor's advanced section
export function TodoEditor({
  accountId,
  target,
  message,
  onClose,
}: {
  accountId: string;
  target?: { threadId: string; isGroup: boolean };
  message?: { msgId: string; text: string };
  onClose: () => void;
}) {
  const base = `/accounts/${accountId}`;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [where, setWhere] = useState(target && { threadId: target.threadId, isGroup: target.isGroup });
  const [group, setGroup] = useState<GroupDetails>();
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [due, setDue] = useState(() => toLocal(defaultDue()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<Thread[]>(`${base}/threads?limit=500`).then(setThreads, (e) => setError(e.message));
  }, [accountId]);
  // a group offers its members (only owner, deputies and self where it hides them); a 1-1 both sides
  useEffect(() => {
    setPicked([]);
    setGroup(undefined);
    if (where?.isGroup) api<GroupDetails>(`${base}/groups/${where.threadId}`).then(setGroup, (e) => setError(e.message));
  }, [where?.threadId]);

  const thread = threads.find((t) => t.threadId === where?.threadId);
  const people: TodoPerson[] = !where
    ? []
    : where.isGroup
      ? (group?.members ?? [])
      : [
          { userId: accountId, name: "Bạn", avatar: "" },
          { userId: where.threadId, name: thread?.name ?? where.threadId, avatar: thread?.avatar ?? "" },
        ];
  const who = (p: TodoPerson) => (p.userId === accountId ? "Bạn" : p.name);
  const shown = people.filter((p) => fold(who(p)).includes(fold(q.trim())));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const text = message?.text ?? content;

  const submit = () => {
    if (!where) return;
    const dueDate = due ? new Date(due).getTime() : -1;
    if (dueDate !== -1 && dueDate <= Date.now()) return setError("Vui lòng chọn ngày giờ trong tương lai");
    setBusy(true);
    setError(undefined);
    api(`${base}/todos`, "POST", { threadId: where.threadId, isGroup: where.isGroup, msgId: message?.msgId, content: text, title, assignees: picked, dueDate }).then(
      onClose,
      (e) => (setError(e.message), setBusy(false)),
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[460px]">
        <DialogTitle>Giao công việc mới</DialogTitle>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
          {message ? (
            <p className="line-clamp-3 rounded-md bg-muted px-3 py-2 text-[13px] break-words whitespace-pre-wrap">{message.text}</p>
          ) : (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Nội dung
              <Textarea autoFocus rows={4} maxLength={MAX_CONTENT} placeholder="Nhập nội dung công việc" value={content} onChange={(e) => setContent(e.target.value)} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm font-medium">
            Tiêu đề
            <Input maxLength={MAX_TITLE} placeholder="Nhập tiêu đề để dễ nhớ hơn. VD: Chuẩn bị báo cáo" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Giao tại
            {message ? (
              <span className="font-normal">{thread?.name ?? where?.threadId}</span>
            ) : (
              <select
                className="h-8 rounded-md border bg-background px-2 font-normal"
                value={where?.threadId ?? ""}
                onChange={(e) => {
                  const t = threads.find((x) => x.threadId === e.target.value);
                  setWhere(t && { threadId: t.threadId, isGroup: t.isGroup });
                }}
              >
                <option value="" disabled>
                  Chọn hội thoại
                </option>
                {threads.map((t) => (
                  <option key={t.threadId} value={t.threadId}>
                    {t.name ?? t.threadId}
                  </option>
                ))}
              </select>
            )}
          </label>
          {where && (
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Giao cho</span>
              {people.length > 8 && <Input placeholder="Tìm theo tên" value={q} onChange={(e) => setQ(e.target.value)} />}
              <div className="max-h-44 overflow-y-auto">
                {shown.map((p) => (
                  <label key={p.userId} className="flex cursor-pointer items-center gap-2.5 rounded-lg p-1.5 hover:bg-muted">
                    <Checkbox checked={picked.includes(p.userId)} onCheckedChange={() => toggle(p.userId)} />
                    <Avatar src={p.avatar} name={who(p)} size={28} />
                    <span className="min-w-0 flex-1 truncate">{who(p)}</span>
                  </label>
                ))}
              </div>
              {group?.locked && <span className={MUTED}>Bạn chỉ có thể giao cho bản thân và trưởng/phó nhóm.</span>}
              {!picked.length && <span className={MUTED}>Giao cho bản thân</span>}
            </div>
          )}
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Thời hạn</span>
            <div className="flex gap-1">
              <Input type="datetime-local" min={toLocal(Date.now())} value={due} onChange={(e) => setDue(e.target.value)} />
              {due && (
                <Button variant="ghost" size="icon" title="Bỏ thời hạn" onClick={() => setDue("")}>
                  <XIcon />
                </Button>
              )}
            </div>
            {!due && <span className={MUTED}>Công việc chưa có thời hạn (deadline)</span>}
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={busy || !where || !text.trim()} onClick={submit}>
            Giao việc
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
