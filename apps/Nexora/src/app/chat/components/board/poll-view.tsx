import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import { params, attach } from "@/app/chat/utils/chat.utils";
import type { Poll } from "@/shared/types";
import { Confirm } from "@/shared/components/dialogs/confirm-dialog";
import type { Ask } from "@/shared/models/dialog.model";
import { useAction } from "@/app/chat/hooks/useAction";
import { MUTED, MAX_OPTION } from "@/app/chat/constants/board.constants";
import { when } from "@/app/chat/utils/board.utils";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils/shadcn";

// a poll: vote (one or many), add options when allowed, end it ("Khóa bình chọn"); reloads on votes from anyone
export function PollView({ base, threadId, pollId, onClose }: { base: string; threadId: string; pollId: string; onClose: () => void }) {
  const url = `${base}/polls/${pollId}`;
  const [poll, setPoll] = useState<Poll>();
  const [picked, setPicked] = useState<number[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [ask, setAsk] = useState<Ask>();
  const { busy, error, setError, act } = useAction();
  const show = (p: Poll) => (setPoll(p), setPicked(p.options.filter((o) => o.mine).map((o) => o.id)), setAdded([]));
  const load = () =>
    api<Poll>(url)
      .then(show)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    return onEvent((e) => {
      const poll = e.type === "message" && e.message.threadId === threadId && e.message.msgType === "group.poll" && String(params(attach(e.message.content)).pollId) === pollId;
      if (poll || (e.type === "board" && e.threadId === threadId)) load();
    });
  }, [url]);

  if (!poll) return null;
  const open = !poll.closed && (!poll.expiredTime || poll.expiredTime > Date.now());
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : poll.multi ? [...p, id] : [id]));
  const changed = added.length > 0 || [...picked].sort().join() !== poll.options.filter((o) => o.mine).map((o) => o.id).sort().join();
  const most = Math.max(1, ...poll.options.map((o) => o.votes ?? 0));
  const vote = () => act(() => api<Poll>(`${url}/votes`, "POST", { optionIds: picked, newOptions: added }).then(show));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[440px]">
        <DialogTitle>{poll.question}</DialogTitle>
        <p className={MUTED}>
          Tạo bởi {poll.creatorName} · {poll.numVote} người đã bình chọn
          {!open ? " · Bình chọn đã kết thúc" : poll.expiredTime ? ` · Kết thúc lúc ${when(poll.expiredTime)}` : ""}
        </p>
        <p className={MUTED}>{[poll.multi ? "Chọn nhiều phương án" : "Chọn một phương án", poll.anonymous && "Ẩn người bình chọn", poll.hideResults && "Kết quả hiện sau khi bình chọn"].filter(Boolean).join(" · ")}</p>
        <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
          {poll.options.map((o) => (
            <label key={o.id} className={cn("relative flex items-center gap-2 overflow-hidden rounded-md border px-3 py-2", open && "cursor-pointer hover:bg-muted")}>
              {o.votes !== null && <span className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${(o.votes / most) * 100}%` }} />}
              <Checkbox className="relative" disabled={!open} checked={picked.includes(o.id)} onCheckedChange={() => toggle(o.id)} />
              <span className="relative min-w-0 flex-1 break-words">{o.content}</span>
              {o.votes !== null && (
                <span className="relative text-xs text-muted-foreground" title={o.voters?.map((v) => v.name).join(", ")}>
                  {o.votes}
                </span>
              )}
            </label>
          ))}
          {added.map((a) => (
            <div key={a} className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2">
              <span className="min-w-0 flex-1 break-words">{a}</span>
              <Button variant="ghost" size="icon-xs" title="Bỏ" onClick={() => setAdded(added.filter((x) => x !== a))}>
                <XIcon />
              </Button>
            </div>
          ))}
          {open && poll.canAddOption && (
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                const v = draft.trim();
                if (v && !added.includes(v) && !poll.options.some((o) => o.content === v)) setAdded([...added, v]);
                setDraft("");
              }}
            >
              <Input maxLength={MAX_OPTION} placeholder="Thêm phương án" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <Button variant="outline" disabled={!draft.trim()}>
                Thêm
              </Button>
            </form>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <DialogFooter>
          {poll.canLock && (
            <Button
              variant="destructive"
              className="mr-auto"
              onClick={() => setAsk({ title: "Khóa bình chọn", message: "Mọi người sẽ không thể bình chọn nữa. Khóa bình chọn này?", ok: "Khóa bình chọn", run: () => api(`${url}/lock`, "POST").then(load) })}
            >
              Khóa bình chọn
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          {open && (
            <Button disabled={busy || !changed} onClick={vote}>
              Bình chọn
            </Button>
          )}
        </DialogFooter>
        {ask && <Confirm ask={ask} onClose={() => setAsk(undefined)} />}
      </DialogContent>
    </Dialog>
  );
}
