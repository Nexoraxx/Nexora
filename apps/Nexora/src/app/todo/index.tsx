import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { Confirm } from "@/shared/components/dialogs/confirm-dialog";
import type { Ask } from "@/shared/models/dialog.model";
import type { Todo, TodoTarget, TodoList, TodoPerson } from "@/app/todo/models/todo.model";
import { MUTED } from "@/app/todo/constants/todo.constants";
import { TodoEditor } from "@/app/todo/components/todo-editor";
import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/utils/shadcn";

// Zalo PC's TODO_STATUS; "Nội dung" ≤ 2000, "Tiêu đề" ≤ 100
const WAITING = -1;
const IN_PROCESS = 0;
const DONE = 1;

const STATUS: Record<number, [string, string]> = {
  [WAITING]: ["Chưa nhận", "bg-amber-100 text-amber-800"],
  [IN_PROCESS]: ["Đã nhận", "bg-blue-100 text-blue-800"],
  [DONE]: ["Đã hoàn thành", "bg-green-100 text-green-800"],
};

type Tab = "assigner" | "assignee" | "watcher";
// PC's tabs with their empty lists (unfinished, finished)
const TABS: [Tab, string, string, string][] = [
  ["assigner", "Tôi giao", "Danh sách này sẽ gồm các công việc bạn giao cho người khác mà họ chưa hoàn thành.", "Danh sách này sẽ gồm các công việc bạn giao cho người khác mà họ đã hoàn thành."],
  ["assignee", "Cần làm", "Danh sách này sẽ gồm các công việc giao cho bạn mà bạn chưa hoàn thành.", "Danh sách này sẽ gồm các công việc giao cho bạn mà bạn đã hoàn thành."],
  ["watcher", "Theo dõi", "Danh sách này sẽ gồm các công việc giao cho thành viên mà họ chưa hoàn thành, bạn trong danh sách theo dõi.", "Danh sách này sẽ gồm các công việc giao cho thành viên mà họ chưa hoàn thành, bạn trong danh sách theo dõi."],
];
const inTab = (t: Todo, tab: Tab, me: string) =>
  tab === "assigner" ? t.creator.userId === me : tab === "assignee" ? t.assignees.some((a) => a.userId === me) : t.watchers.includes(me);

const when = (ms: number) => new Date(ms).toLocaleString("vi", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });

// PC's confirm before finishing or reopening (changeTaskStatus); receiving asks nothing
function statusAsk(t: Todo, me: string, status: number): Pick<Ask, "title" | "message"> {
  const creator = t.creator.userId === me;
  if (status !== DONE)
    return creator
      ? { title: "Giao lại công việc?", message: "Người bạn giao việc sẽ nhận được thông báo bạn giao lại công việc. Công việc sẽ được chuyển sang danh mục Chưa xong." }
      : { title: "Mở lại công việc này?", message: "" };
  if (creator)
    return {
      title: "Kết thúc công việc?",
      message:
        t.assignees.some((a) => a.userId === me) && t.assignees.length <= 1
          ? "HOÀN THÀNH công việc sẽ chuyển công việc sang danh sách Hoàn thành."
          : "Công việc sẽ được chuyển sang danh mục Đã Xong trên cả phía bạn và người bạn giao việc.",
    };
  return { title: "Hoàn thành công việc?", message: `${t.creator.name} sẽ nhận được thông báo bạn đã hoàn thành công việc. Công việc sẽ được chuyển sang danh mục Đã Xong.` };
}

// Zalo PC's To-Do: "Tôi giao" (created), "Cần làm" (assigned), "Theo dõi" (watching), each split into "Chưa xong" /
// "Đã xong", newest change first; a row opens its source message. Offered only where Zalo turned the feature on.
// ponytail: no search, advanced filters, stats or editing; PC's detail view is the place to add them
export function Todos({ accountId, online, onOpen }: { accountId: string; online: boolean; onOpen: (t: TodoTarget) => void }) {
  const base = `/accounts/${accountId}/todos`;
  const [data, setData] = useState<TodoList>();
  const [tab, setTab] = useState<Tab>("assigner");
  const [done, setDone] = useState(false);
  const [creating, setCreating] = useState(false);
  const [ask, setAsk] = useState<Ask>();
  const [note, setNote] = useState<{ text: string; error?: boolean }>();
  const load = () => api<TodoList>(base).then(setData, (e) => setNote({ text: e.message, error: true }));
  useEffect(() => {
    if (!online) return;
    load();
    return onEvent((e) => e.type === "todos" && e.accountId === accountId && load());
  }, [accountId, online]);
  const run = (p: Promise<unknown>, ok?: string) => (setNote(undefined), p.then(() => (ok && setNote({ text: ok }), load()), (e) => setNote({ text: e.message, error: true })));
  const who = (p: TodoPerson) => (p.userId === accountId ? "Bạn" : p.name);
  const status = (t: Todo, s: number) => api(`${base}/${t.id}/status`, "PUT", { status: s });

  if (!online) return <p className={cn(MUTED, "p-4")}>Cần kết nối</p>;
  if (!data) return <p className={cn(MUTED, "p-4")}>{note?.text ?? "Đang tải dữ liệu"}</p>;
  if (!data.enabled) return <p className="p-4">Zalo chưa bật To-Do cho tài khoản này.</p>;

  const mine = data.todos.filter((t) => inTab(t, tab, accountId));
  const open = mine.filter((t) => t.status !== DONE);
  const closed = mine.filter((t) => t.status === DONE);
  const [, , emptyOpen, emptyDone] = TABS.find(([key]) => key === tab)!;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
      <div className="flex items-center gap-3 p-4">
        <h2 className="text-base font-semibold">Công việc</h2>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            {TABS.map(([key, label]) => (
              <TabsTrigger key={key} value={key}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button className="ml-auto" onClick={() => setCreating(true)}>
          Giao việc
        </Button>
      </div>
      <div className="flex gap-1.5 px-4 pb-2">
        <Button size="sm" variant={done ? "outline" : "default"} onClick={() => setDone(false)}>
          Chưa xong: {open.length}
        </Button>
        <Button size="sm" variant={done ? "default" : "outline"} onClick={() => setDone(true)}>
          Đã xong: {closed.length}
        </Button>
      </div>
      {note && <p className={cn("px-4 pb-2 text-xs", note.error ? "text-red-600" : "text-green-700")}>{note.text}</p>}
      <div className="flex-1 overflow-y-auto px-4">
        {!(done ? closed : open).length && <p className={cn(MUTED, "py-4 text-center")}>{done ? emptyDone : emptyOpen}</p>}
        {(done ? closed : open).map((t) => {
          const creator = t.creator.userId === accountId;
          const assignee = t.assignees.some((a) => a.userId === accountId);
          const overdue = t.dueDate > 0 && t.dueDate < Date.now() && t.status !== DONE;
          const change = (s: number) => setAsk({ ...statusAsk(t, accountId, s), ok: "Có", run: () => status(t, s).then(load) });
          return (
            <div key={t.id} className="mb-2 rounded-lg border p-3">
              <button
                className="flex w-full flex-col gap-1 text-left"
                title="Nhấn để xem tin nhắn gốc"
                onClick={() => onOpen({ threadId: t.thread.threadId, isGroup: t.thread.isGroup, name: t.thread.name, avatar: t.thread.avatar, msgId: t.msgId ?? undefined })}
              >
                <div className="flex items-start gap-2">
                  <span className="line-clamp-2 min-w-0 flex-1 font-medium break-words">{t.title || t.content}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs", STATUS[t.status]?.[1])}>{STATUS[t.status]?.[0]}</span>
                </div>
                {t.title && t.content && <p className="line-clamp-2 text-[13px] break-words text-muted-foreground">{t.content}</p>}
                <div className={cn(MUTED, "flex items-center gap-1.5")}>
                  <Avatar src={t.thread.avatar} name={t.thread.name} size={18} />
                  <span className="truncate" title={t.assignees.map((a) => `${who(a)}: ${STATUS[a.status]?.[0]}`).join("\n")}>
                    {t.thread.name} · {who(t.creator)} giao cho {t.assignees.map(who).join(", ")}
                  </span>
                </div>
                {t.dueDate > 0 && (
                  <div className={cn(MUTED, overdue && "text-red-600")}>
                    Thời hạn: {when(t.dueDate)}
                    {overdue && " · Quá hạn"}
                  </div>
                )}
              </button>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {assignee && t.status === WAITING ? (
                  <Button size="sm" onClick={() => run(status(t, IN_PROCESS))}>
                    Nhận việc
                  </Button>
                ) : (
                  (creator || assignee) && (
                    <Button size="sm" variant="outline" onClick={() => change(t.status === DONE ? IN_PROCESS : DONE)}>
                      {t.status === DONE ? "Mở lại công việc" : "Hoàn thành công việc"}
                    </Button>
                  )
                )}
                {creator && t.status !== DONE && t.assignees.some((a) => a.userId !== accountId && a.status !== DONE) && (
                  <Button size="sm" variant="outline" onClick={() => run(api(`${base}/${t.id}/remind`, "POST"), "Bạn đã gửi yêu cầu cập nhật công việc")}>
                    Nhắc nhở
                  </Button>
                )}
                {creator && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setAsk({
                        title: "Xoá công việc",
                        message: "Công việc này sẽ không còn hiển thị trên danh sách của bạn. Bạn có chắc rằng bạn muốn xoá công việc này không?",
                        ok: "Xoá",
                        run: () => api(`${base}/${t.id}`, "DELETE").then(load),
                      })
                    }
                  >
                    Xoá công việc
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {creating && <TodoEditor accountId={accountId} onClose={() => (setCreating(false), load())} />}
      {ask && <Confirm ask={ask} onClose={() => setAsk(undefined)} />}
    </div>
  );
}
