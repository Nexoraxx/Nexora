import { useEffect, useState, type ReactNode } from "react";
import { PlusIcon } from "lucide-react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import type { Account, ChatTarget } from "@/shared/types";
import type { Recipient, Run } from "@/app/bulk-send/models/bulk-send.model";
import { BADGE, MUTED, RECIPIENT_STATE, RUN_STATE, UNKNOWN_HINT } from "@/app/bulk-send/constants/bulk-send.constants";
import { CreateRun } from "@/app/bulk-send/components/create-run";
import { Templates } from "@/app/bulk-send/components/templates";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { Confirm } from "@/shared/components/dialogs/confirm-dialog";
import type { Ask } from "@/shared/models/dialog.model";
import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/utils/shadcn";

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-3 py-2">
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
      {note && <p className="border-b bg-red-50 px-3 py-1.5 text-xs text-red-700">{note}</p>}

      {tab === "templates" ? (
        <Templates />
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-r p-2">
            {list.map((r) => {
              const [label, color] = RUN_STATE[r.state];
              const done = r.total - r.pending;
              const unclear = done - r.sent - r.failed;
              return (
                <div
                  key={`${r.accountId}:${r.id}`}
                  className={cn("cursor-pointer rounded-lg border p-2.5 hover:bg-muted/50", r === run && "border-primary/50 bg-primary/5")}
                  onClick={() => setPicked({ accountId: r.accountId, id: r.id })}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                    <span className={cn(BADGE, color)}>{label}</span>
                  </div>
                  <div className="my-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full", r.state === "paused" ? "bg-amber-500" : "bg-primary")} style={{ width: `${(done / Math.max(1, r.total)) * 100}%` }} />
                  </div>
                  <div className={cn(MUTED, "flex flex-wrap items-center gap-x-1.5")}>
                    {tag?.(r.accountId)}
                    <span>
                      {done}/{r.total}
                      {r.failed > 0 && ` · ${r.failed} lỗi`}
                      {unclear > 0 && ` · ${unclear} không rõ`} · {when(r.createdAt)}
                    </span>
                  </div>
                  {r.state === "paused" && r.pauseReason && <p className="mt-1 text-xs text-amber-800">{r.pauseReason}</p>}
                  {(r.state === "running" || r.state === "paused") && (
                    <div className="mt-2 flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {r.state === "running" ? (
                        <Button variant="outline" size="xs" onClick={() => act(r, "pause")}>
                          Tạm dừng
                        </Button>
                      ) : (
                        <Button variant="outline" size="xs" onClick={() => act(r, "resume")}>
                          Tiếp tục
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="xs"
                        className="text-destructive"
                        onClick={() =>
                          setAsk({ title: "Huỷ đợt gửi?", message: `${r.pending} người chưa được gửi sẽ bị bỏ qua. Không tiếp tục được nữa.`, ok: "Huỷ đợt gửi", run: () => act(r, "cancel") })
                        }
                      >
                        Huỷ
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {!list.length && <p className={cn(MUTED, "p-4 text-center")}>Chưa có đợt gửi nào. Soạn mẫu ở tab Mẫu tin rồi bấm Tạo đợt gửi.</p>}
          </aside>
          <div className="min-w-0 flex-1 overflow-y-auto p-3">
            {run ? (
              <>
                <p className="mb-2 font-semibold">
                  {run.name} · {run.total} người
                </p>
                {recipients.map((p) => {
                  const [label, color] = RECIPIENT_STATE[p.state];
                  return (
                    <button
                      key={p.userId}
                      className="flex w-full items-center gap-2.5 border-b px-1 py-2 text-left hover:bg-muted/50"
                      title={p.state === "unknown" ? UNKNOWN_HINT : p.text}
                      onClick={() => onOpen({ threadId: p.userId, isGroup: false, name: p.name, avatar: p.avatar, accountId: run.accountId })}
                    >
                      <Avatar src={p.avatar} name={p.name} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p.name}</span>
                        {p.error && <span className="block truncate text-xs text-red-600">{p.error}</span>}
                        {p.state === "unknown" && <span className="block truncate text-xs text-violet-700">{UNKNOWN_HINT}</span>}
                      </span>
                      {p.sentAt && <span className={MUTED}>{when(p.sentAt)}</span>}
                      <span className={cn(BADGE, color)}>{label}</span>
                    </button>
                  );
                })}
              </>
            ) : (
              <p className={cn(MUTED, "mt-10 text-center")}>Chọn một đợt gửi để xem từng người nhận</p>
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
