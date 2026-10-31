import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { Confirm } from "@/shared/components/dialogs/confirm-dialog";
import type { Ask } from "@/shared/models/dialog.model";
import type { Account } from "@/shared/types";
import type { Todo, TodoTarget, TodoList, TodoPerson } from "@/app/todo/models/todo.model";
import { MUTED } from "@/app/todo/constants/todo.constants";
import { TodoEditor } from "@/app/todo/components/todo-editor";
import { Button } from "@/shared/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
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
// "Tất cả" merges every account's todos, each tagged with its account and acted on as that account.
// ponytail: no search, advanced filters, stats or editing; PC's detail view is the place to add them
type Row = Todo & { accountId: string };

export function Todos({ accounts, tag, onOpen }: { accounts: Account[]; tag?: (accountId: string) => ReactNode; onOpen: (t: TodoTarget & { accountId: string }) => void }) {
  // by account id, once fetched
  const [data, setData] = useState<Record<string, TodoList>>({});
  const [tab, setTab] = useState<Tab>("assigner");
  const [done, setDone] = useState(false);
  // the account a new todo is given from
  const [creating, setCreating] = useState<string>();
  const [ask, setAsk] = useState<Ask>();
  const [note, setNote] = useState<{ text: string; error?: boolean }>();
  const online = accounts.filter((a) => a.status === "online").map((a) => a.id);
  const load = (id: string) => api<TodoList>(`/accounts/${id}/todos`).then((d) => setData((m) => ({ ...m, [id]: d })), (e) => setNote({ text: e.message, error: true }));
  useEffect(() => {
    online.forEach(load);
    return onEvent((e) => e.type === "todos" && online.includes(e.accountId) && load(e.accountId));
  }, [online.join()]);
  const run = (id: string, p: Promise<unknown>, ok?: string) =>
    (setNote(undefined), p.then(() => (ok && setNote({ text: ok }), load(id)), (e) => setNote({ text: e.message, error: true })));
  const status = (t: Row, s: number) => api(`/accounts/${t.accountId}/todos/${t.id}/status`, "PUT", { status: s });

  if (!online.length) return <p className={cn(MUTED, "p-4")}>Cần kết nối</p>;
  const loaded = online.filter((id) => data[id]);
  if (!loaded.length) return <p className={cn(MUTED, "p-4")}>{note?.text ?? "Đang tải dữ liệu"}</p>;
  const enabled = loaded.filter((id) => data[id].enabled);
  if (!enabled.length) return <p className="p-4">Zalo chưa bật To-Do cho {accounts.length > 1 ? "các tài khoản này" : "tài khoản này"}.</p>;
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  const mine = enabled
    .flatMap((id) => data[id].todos.map((t): Row => ({ ...t, accountId: id })))
    .filter((t) => inTab(t, tab, t.accountId))
    .sort((a, b) => b.updateTime - a.updateTime);
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
        {enabled.length > 1 ? (
          // several accounts with To-Do: pick the one the todo is given from
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="ml-auto">Giao việc</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {enabled.map((id) => (
                <DropdownMenuItem key={id} onSelect={() => setCreating(id)}>
                  Giao từ <span className="truncate font-medium">{name(id)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button className="ml-auto" onClick={() => setCreating(enabled[0])}>
            Giao việc
          </Button>
        )}
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
          const me = t.accountId;
          const who = (p: TodoPerson) => (p.userId === me ? "Bạn" : p.name);
          const creator = t.creator.userId === me;
          const assignee = t.assignees.some((a) => a.userId === me);
          const overdue = t.dueDate > 0 && t.dueDate < Date.now() && t.status !== DONE;
          const change = (s: number) => setAsk({ ...statusAsk(t, me, s), ok: "Có", run: () => status(t, s).then(() => load(me)) });
          return (
            <div key={`${me}:${t.id}`} className="mb-2 rounded-lg border p-3">
              <button
                className="flex w-full flex-col gap-1 text-left"
                title="Nhấn để xem tin nhắn gốc"
                onClick={() => onOpen({ threadId: t.thread.threadId, isGroup: t.thread.isGroup, name: t.thread.name, avatar: t.thread.avatar, msgId: t.msgId ?? undefined, accountId: me })}
              >
                <div className="flex items-start gap-2">
                  <span className="line-clamp-2 min-w-0 flex-1 font-medium break-words">{t.title || t.content}</span>
                  {tag?.(me)}
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
                  <Button size="sm" onClick={() => run(me, status(t, IN_PROCESS))}>
                    Nhận việc
                  </Button>
                ) : (
                  (creator || assignee) && (
                    <Button size="sm" variant="outline" onClick={() => change(t.status === DONE ? IN_PROCESS : DONE)}>
                      {t.status === DONE ? "Mở lại công việc" : "Hoàn thành công việc"}
                    </Button>
                  )
                )}
                {creator && t.status !== DONE && t.assignees.some((a) => a.userId !== me && a.status !== DONE) && (
                  <Button size="sm" variant="outline" onClick={() => run(me, api(`/accounts/${me}/todos/${t.id}/remind`, "POST"), "Bạn đã gửi yêu cầu cập nhật công việc")}>
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
                        run: () => api(`/accounts/${me}/todos/${t.id}`, "DELETE").then(() => load(me)),
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
      {creating && <TodoEditor accountId={creating} onClose={() => (setCreating(undefined), load(creating))} />}
      {ask && <Confirm ask={ask} onClose={() => setAsk(undefined)} />}
    </div>
  );
}
