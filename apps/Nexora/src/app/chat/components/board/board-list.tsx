import { useEffect, useState } from "react";
import { AlarmClockIcon, ListChecksIcon, StickyNoteIcon } from "lucide-react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import type { BoardItem, Reminder } from "@/shared/types";
import { MUTED, REPEAT } from "@/app/chat/constants/board.constants";
import { when } from "@/app/chat/utils/board.utils";
import { NoteEditor } from "@/app/chat/components/board/note-editor";
import { ReminderEditor } from "@/app/chat/components/board/reminder-editor";
import { PollView } from "@/app/chat/components/board/poll-view";
import { Button } from "@/shared/components/ui/button";

// the thread's "Bảng tin" for the info panel: reminders (both kinds of thread), then a group's notes and polls
export function BoardList({ accountId, threadId, isGroup }: { accountId: string; threadId: string; isGroup: boolean }) {
  const thread = `/accounts/${accountId}/threads/${threadId}`;
  const group = `/accounts/${accountId}/groups/${threadId}`;
  const [items, setItems] = useState<BoardItem[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [open, setOpen] = useState<{ note?: BoardItem; reminder?: Reminder; pollId?: string; create?: "note" | "reminder" }>();
  const [error, setError] = useState<string>();
  const load = () => {
    api<Reminder[]>(`${thread}/reminders?isGroup=${isGroup}`)
      .then(setReminders)
      .catch((e) => setError(e.message));
    if (isGroup)
      api<BoardItem[]>(`${group}/board`)
        .then(setItems)
        .catch((e) => setError(e.message));
  };
  useEffect(() => {
    load();
    return onEvent((e) => {
      if (e.type === "board" && e.accountId === accountId && e.threadId === threadId) load();
    });
  }, [threadId]);
  const respond = (r: Reminder, accept: boolean) =>
    api(`${group}/reminders/${r.id}/response`, "POST", { accept })
      .then(load)
      .catch((e) => setError(e.message));
  const row = "flex w-full items-start gap-3 px-4 py-1.5 text-left hover:bg-muted";

  return (
    <>
      {error && <p className="px-4 text-xs text-red-600">{error}</p>}
      {!reminders.length && !items.length && <p className="px-4 py-1 text-xs text-muted-foreground">Chưa có ghi chú, bình chọn hay nhắc hẹn</p>}
      {reminders.map((r) => (
        <div key={r.id} className={row}>
          <AlarmClockIcon className="mt-0.5 size-5 shrink-0 text-orange-500" />
          <button className="min-w-0 flex-1 text-left" onClick={() => setOpen({ reminder: r })}>
            <div className="line-clamp-2 break-words">{r.title}</div>
            <div className={MUTED}>
              {when(r.startTime)}
              {r.repeat ? ` · ${REPEAT[r.repeat]}` : ""}
              {isGroup && ` · ${r.accepted ?? 0} người tham gia`}
            </div>
          </button>
          {isGroup && (
            <div className="flex shrink-0 gap-1">
              <Button size="xs" variant={r.myResponse === 1 ? "default" : "outline"} onClick={() => respond(r, true)}>
                Tham gia
              </Button>
              <Button size="xs" variant={r.myResponse === 2 ? "default" : "outline"} onClick={() => respond(r, false)}>
                Từ chối
              </Button>
            </div>
          )}
        </div>
      ))}
      {items.map((i) => (
        <button key={`${i.kind}${i.id}`} className={row} onClick={() => setOpen(i.kind === "poll" ? { pollId: i.id } : { note: i })}>
          {i.kind === "poll" ? <ListChecksIcon className="mt-0.5 size-5 shrink-0 text-primary" /> : <StickyNoteIcon className="mt-0.5 size-5 shrink-0 text-yellow-500" />}
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 break-words">{i.title}</div>
            <div className={MUTED}>{i.kind === "poll" ? (i.closed ? "Bình chọn đã kết thúc" : "Bình chọn") : "Ghi chú"}</div>
          </div>
        </button>
      ))}
      <div className="flex gap-2 px-4 pt-1">
        {isGroup && (
          <Button variant="outline" size="sm" onClick={() => setOpen({ create: "note" })}>
            Tạo ghi chú
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setOpen({ create: "reminder" })}>
          Tạo nhắc hẹn
        </Button>
      </div>
      {(open?.note || open?.create === "note") && <NoteEditor base={group} note={open.note} onClose={() => (setOpen(undefined), load())} />}
      {(open?.reminder || open?.create === "reminder") && <ReminderEditor base={thread} isGroup={isGroup} reminder={open.reminder} onClose={() => (setOpen(undefined), load())} />}
      {open?.pollId && <PollView base={group} threadId={threadId} pollId={open.pollId} onClose={() => setOpen(undefined)} />}
    </>
  );
}
