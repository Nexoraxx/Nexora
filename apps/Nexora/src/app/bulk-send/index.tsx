import { useEffect, useState, type ReactNode } from "react";
import { InboxIcon, PauseIcon, PlayIcon, PlusIcon, SearchIcon, SendIcon, Trash2Icon } from "lucide-react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import type { Account, ChatTarget } from "@/shared/types";
import type { Recipient, Run } from "@/app/bulk-send/models/bulk-send.model";
import { BADGE, RECIPIENT_STATE, RUN_STATE, UNKNOWN_HINT } from "@/app/bulk-send/constants/bulk-send.constants";
import { CreateRun } from "@/app/bulk-send/components/create-run";
import { Templates } from "@/app/bulk-send/components/templates";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { Confirm } from "@/shared/components/dialogs/confirm-dialog";
import type { Ask } from "@/shared/models/dialog.model";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/utils/shadcn";
import { fold } from "@/shared/utils/text.utils";

const when = (ms: number) => new Date(ms).toLocaleString("vi", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
type Picked = { accountId: string; id: number };

// "Gửi hàng loạt": the runs ("Đợt gửi") of the accounts on screen, merged and tagged on "Tất cả", and the templates
// ("Mẫu tin"). A recipient opens the conversation, e.g. to check one marked "Không rõ".
export function BulkSend({ accounts, tag, onOpen }: { accounts: Account[]; tag?: (accountId: string) => ReactNode; onOpen: (t: ChatTarget) => void }) {
  const [tab, setTab] = useState<"runs" | "templates">("runs");
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const [picked, setPicked] = useState<Picked>();
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [creating, setCreating] = useState(false);
  const [ask, setAsk] = useState<Ask>();
  const [note, setNote] = useState<string>();
  const [filterState, setFilterState] = useState<"all" | "sent" | "pending" | "failed">("all");
  const [q, setQ] = useState("");
  const ids = accounts.map((a) => a.id);
  const load = (id: string) => api<Run[]>(`/accounts/${id}/bulk-sends`).then((list) => setRuns((m) => ({ ...m, [id]: list })), (e) => setNote(e.message));
  const loadRecipients = (p: Picked) => api<Recipient[]>(`/accounts/${p.accountId}/bulk-sends/${p.id}/recipients`).then(setRecipients, (e) => setNote(e.message));

  useEffect(() => {
    ids.forEach(load);
    return onEvent((e) => e.type === "bulk_sends" && ids.includes(e.accountId) && load(e.accountId));
  }, [ids.join()]);
  // the open run follows its progress
  useEffect(() => {
    if (!picked) return setRecipients([]);
    loadRecipients(picked);
    return onEvent((e) => e.type === "bulk_sends" && e.accountId === picked.accountId && loadRecipients(picked));
  }, [picked?.accountId, picked?.id]);

  const list = ids.flatMap((id) => runs[id] ?? []).sort((a, b) => b.createdAt - a.createdAt);
  const run = list.find((r) => r.accountId === picked?.accountId && r.id === picked?.id);
  const online = accounts.filter((a) => a.status === "online");
  const act = (r: Run, action: "pause" | "resume" | "cancel") =>
    api(`/accounts/${r.accountId}/bulk-sends/${r.id}/${action}`, "POST").then(() => setNote(undefined), (e) => setNote(e.message));

  const filteredRecipients = recipients.filter((p) => {
    if (filterState === "sent" && p.state !== "sent") return false;
    if (filterState === "pending" && p.state !== "pending" && p.state !== "sending") return false;
    if (filterState === "failed" && p.state !== "failed" && p.state !== "unknown") return false;
    if (q.trim() && !fold(p.name).includes(fold(q.trim())) && !fold(p.text).includes(fold(q.trim()))) return false;
    return true;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-3 py-2 bg-card/30">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="runs">Đợt gửi</TabsTrigger>
            <TabsTrigger value="templates">Mẫu tin</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "runs" && (
          <Button size="sm" className="ml-auto" disabled={!online.length} title={online.length ? undefined : "Cần một tài khoản đang kết nối"} onClick={() => setCreating(true)}>
            <PlusIcon /> Tạo đợt gửi
          </Button>
        )}
      </div>
      {note && <p className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{note}</p>}

      {tab === "templates" ? (
        <Templates />
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="flex w-84 shrink-0 flex-col gap-2 overflow-y-auto border-r p-2 bg-muted/10">
            {list.map((r) => {
              const [label, color] = RUN_STATE[r.state];
              const done = r.total - r.pending;
              const percent = Math.round((done / Math.max(1, r.total)) * 100);
              const isSelected = r.accountId === picked?.accountId && r.id === picked?.id;
              return (
                <div
                  key={`${r.accountId}:${r.id}`}
                  className={cn(
                    "cursor-pointer rounded-xl border p-3 transition-all",
                    isSelected
                      ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20 shadow-xs"
                      : "border-border/60 bg-card/60 hover:border-border hover:bg-muted/40"
                  )}
                  onClick={() => setPicked({ accountId: r.accountId, id: r.id })}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="min-w-0 flex-1 truncate font-medium text-xs text-foreground">{r.name}</span>
                    <span className={cn(BADGE, color)}>{label}</span>
                  </div>
                  <div className="my-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full transition-all duration-300", r.state === "paused" ? "bg-amber-500" : "bg-primary")}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-2">
                    <div className="flex items-center gap-1.5 truncate">
                      {tag?.(r.accountId)}
                      <span className="font-mono">{done}/{r.total}</span>
                      <span className="opacity-60 font-mono">({percent}%)</span>
                    </div>
                    <span className="shrink-0">{when(r.createdAt).split(" ")[0]}</span>
                  </div>
                  {r.state === "paused" && r.pauseReason && (
                    <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-md">
                      {r.pauseReason}
                    </p>
                  )}
                  {(r.state === "running" || r.state === "paused") && (
                    <div className="mt-2.5 pt-2 border-t border-border/40 flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {r.state === "running" ? (
                        <Button variant="outline" size="xs" onClick={() => act(r, "pause")} className="h-6 text-[11px] gap-1">
                          <PauseIcon className="size-3" /> Tạm dừng
                        </Button>
                      ) : (
                        <Button variant="outline" size="xs" onClick={() => act(r, "resume")} className="h-6 text-[11px] gap-1">
                          <PlayIcon className="size-3" /> Tiếp tục
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="xs"
                        className="h-6 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive gap-1"
                        onClick={() =>
                          setAsk({ title: "Huỷ đợt gửi?", message: `${r.pending} người chưa được gửi sẽ bị bỏ qua. Không tiếp tục được nữa.`, ok: "Huỷ đợt gửi", run: () => act(r, "cancel") })
                        }
                      >
                        <Trash2Icon className="size-3" /> Huỷ
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {!list.length && (
              <div className="py-12 px-4 text-center">
                <InboxIcon className="size-8 mx-auto mb-2 text-muted-foreground/40 stroke-[1.5]" />
                <p className="text-xs font-medium text-foreground">Chưa có đợt gửi nào</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Soạn mẫu ở tab Mẫu tin rồi bấm Tạo đợt gửi để bắt đầu.
                </p>
              </div>
            )}
          </aside>
          <div className="min-w-0 flex-1 flex flex-col overflow-hidden bg-background">
            {run ? (
              <>
                <div className="border-b px-4 py-3 shrink-0 space-y-3 bg-card/40">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold text-foreground truncate">{run.name}</h2>
                        <span className={cn(BADGE, RUN_STATE[run.state][1])}>{RUN_STATE[run.state][0]}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Tạo lúc {when(run.createdAt)} · Tổng {run.total} người nhận
                      </p>
                    </div>
                    {(run.state === "running" || run.state === "paused") && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {run.state === "running" ? (
                          <Button variant="outline" size="sm" onClick={() => act(run, "pause")} className="h-8 text-xs gap-1.5">
                            <PauseIcon className="size-3.5" /> Tạm dừng
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => act(run, "resume")} className="h-8 text-xs gap-1.5">
                            <PlayIcon className="size-3.5" /> Tiếp tục
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs text-destructive hover:bg-destructive/10 gap-1.5"
                          onClick={() =>
                            setAsk({ title: "Huỷ đợt gửi?", message: `${run.pending} người chưa được gửi sẽ bị bỏ qua.`, ok: "Huỷ đợt gửi", run: () => act(run, "cancel") })
                          }
                        >
                          <Trash2Icon className="size-3.5" /> Huỷ
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div className="rounded-lg border border-border/50 bg-background/80 p-2 text-center">
                      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block">Tổng số</span>
                      <span className="text-sm font-bold font-mono text-foreground">{run.total}</span>
                    </div>
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 text-center">
                      <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium uppercase tracking-wider block">Đã gửi</span>
                      <span className="text-sm font-bold font-mono text-emerald-700 dark:text-emerald-400">{run.sent}</span>
                    </div>
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-2 text-center">
                      <span className="text-[10px] text-primary font-medium uppercase tracking-wider block">Đang chờ</span>
                      <span className="text-sm font-bold font-mono text-primary">{run.pending}</span>
                    </div>
                    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2 text-center">
                      <span className="text-[10px] text-destructive font-medium uppercase tracking-wider block">Lỗi / Không rõ</span>
                      <span className="text-sm font-bold font-mono text-destructive">{run.failed + (run.total - run.pending - run.sent - run.failed)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
                      {([
                        { key: "all", label: "Tất cả", count: recipients.length },
                        { key: "sent", label: "Đã gửi", count: recipients.filter((p) => p.state === "sent").length },
                        { key: "pending", label: "Chờ gửi", count: recipients.filter((p) => p.state === "pending" || p.state === "sending").length },
                        { key: "failed", label: "Lỗi", count: recipients.filter((p) => p.state === "failed" || p.state === "unknown").length },
                      ] as const).map((tabItem) => (
                        <button
                          key={tabItem.key}
                          type="button"
                          onClick={() => setFilterState(tabItem.key)}
                          className={cn(
                            "px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors shrink-0 border",
                            filterState === tabItem.key
                              ? "bg-primary text-primary-foreground border-primary shadow-xs"
                              : "bg-muted/40 text-muted-foreground border-border/50 hover:bg-muted hover:text-foreground"
                          )}
                        >
                          {tabItem.label} <span className="font-mono text-[10px] opacity-80">({tabItem.count})</span>
                        </button>
                      ))}
                    </div>
                    <div className="relative w-48 shrink-0">
                      <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        placeholder="Tìm người nhận…"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        className="h-7.5 pl-8 text-xs rounded-lg bg-muted/30"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-1">
                  {filteredRecipients.length === 0 ? (
                    <div className="py-12 text-center text-xs text-muted-foreground">
                      <p className="font-medium text-foreground/80">Không có người nhận phù hợp bộ lọc</p>
                    </div>
                  ) : (
                    filteredRecipients.map((p) => {
                      const [label, color] = RECIPIENT_STATE[p.state];
                      return (
                        <button
                          key={p.userId}
                          type="button"
                          className="flex w-full items-center gap-3 rounded-xl border border-transparent p-2.5 text-left transition-all hover:border-border/60 hover:bg-muted/40 active:scale-[0.99] cursor-pointer"
                          title={p.state === "unknown" ? UNKNOWN_HINT : p.text}
                          onClick={() => onOpen({ threadId: p.userId, isGroup: false, name: p.name, avatar: p.avatar, accountId: run.accountId })}
                        >
                          <Avatar src={p.avatar} name={p.name} size={36} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-semibold text-xs text-foreground">{p.name}</span>
                              {p.sentAt && <span className="text-[10px] text-muted-foreground font-mono">{when(p.sentAt)}</span>}
                            </div>
                            <p className="truncate text-xs text-muted-foreground/80 mt-0.5">{p.text}</p>
                            {p.error && <p className="truncate text-[11px] text-destructive mt-0.5">{p.error}</p>}
                            {p.state === "unknown" && <p className="truncate text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">{UNKNOWN_HINT}</p>}
                          </div>
                          <span className={cn(BADGE, color)}>{label}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <div className="size-12 rounded-2xl bg-muted/60 border border-border/60 flex items-center justify-center mb-3 text-muted-foreground">
                  <SendIcon className="size-6 stroke-[1.5]" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Chọn một đợt gửi</h3>
                <p className="text-xs text-muted-foreground max-w-xs mt-1">
                  Bấm vào một đợt gửi ở danh sách bên trái để theo dõi tiến độ chi tiết từng tin nhắn.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {creating && (
        <CreateRun
          accounts={online}
          onStarted={(accountId, id) => (setCreating(false), setTab("runs"), setPicked({ accountId, id }), load(accountId))}
          onClose={() => setCreating(false)}
        />
      )}
      {ask && <Confirm ask={ask} onClose={() => setAsk(undefined)} />}
    </div>
  );
}

// the top bar's "● Đang gửi 37/198" while any account has a run going; opens "Gửi hàng loạt"
export function BulkProgress({ accounts, onOpen }: { accounts: Account[]; onOpen: () => void }) {
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const ids = accounts.map((a) => a.id).join();
  useEffect(() => {
    const load = (id: string) => api<Run[]>(`/accounts/${id}/bulk-sends`).then((list) => setRuns((m) => ({ ...m, [id]: list })), () => {});
    const list = ids.split(",").filter(Boolean);
    list.forEach(load);
    return onEvent((e) => e.type === "bulk_sends" && list.includes(e.accountId) && load(e.accountId));
  }, [ids]);
  const going = Object.values(runs)
    .flat()
    .filter((r) => r.state === "running");
  if (!going.length) return null;
  const total = going.reduce((n, r) => n + r.total, 0);
  const done = going.reduce((n, r) => n + r.total - r.pending, 0);
  return (
    <button className="flex shrink-0 items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700" onClick={onOpen}>
      <span className="size-1.5 animate-pulse rounded-full bg-blue-600" />
      Đang gửi {done}/{total}
    </button>
  );
}
