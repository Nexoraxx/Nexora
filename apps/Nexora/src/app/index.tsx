import "./app.css";
import { useEffect, useRef, useState } from "react";
import { api } from "@/core/http/api";
import { notify } from "@/core/tauri/native";
import { onEvent } from "@/core/websocket/events";
import type { Account, AccountStatus, ChatTarget, ConversationSettings, MessageRow, Thread } from "@/shared/types";
import { Chat } from "@/app/chat";
import { summary } from "@/app/chat/utils/chat.utils";
import { MENTION_ALL } from "@/shared/constants/text.constants";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { Contacts } from "@/app/contact";
import { ProfileDialog } from "@/app/profile";
import { Starred } from "@/app/starred";
import { SettingsDialog } from "@/app/settings";
import { Todos } from "@/app/todo";
import { PlusIcon, SettingsIcon } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/utils/shadcn";

type Qr = { step: "loading" } | { step: "scan"; image: string } | { step: "scanned"; name: string; avatar: string } | { step: "failed" };

const STATUS_TEXT: Record<AccountStatus, string> = {
  online: "Đang hoạt động",
  connecting: "Đang kết nối…",
  offline: "Mất kết nối",
  kicked: "Bị ngắt vì tài khoản đang mở trên Zalo Web/PC khác",
};
const STATUS_DOT: Record<AccountStatus, string> = { online: "bg-green-500", connecting: "bg-amber-500", offline: "bg-gray-400", kicked: "bg-red-500" };

// Zalo PC notifies messages from others (system messages have no sender) unless the conversation is muted
// ("Tắt thông báo"), hidden or open in the focused window. Groups: "Nhóm: <name>", "<sender> nhắc đến bạn: <text>".
async function notifyMessage(m: MessageRow, open: string | undefined) {
  if (!m.fromUid || m.fromUid === m.accountId || (document.hasFocus() && open === `${m.accountId}:${m.threadId}`)) return;
  const base = `/accounts/${m.accountId}`;
  // hidden conversations ("Ẩn trò chuyện") don't notify either
  const settings = await api<ConversationSettings>(`${base}/conversations`);
  if (m.threadId in settings.muted || settings.hidden.includes(m.threadId)) return;
  // the thread just got this message, so it is among the newest
  const thread = (await api<Thread[]>(`${base}/threads?limit=20`)).find((t) => t.threadId === m.threadId);
  const text = summary(m.msgType, m.content);
  if (!thread?.isGroup) return notify(thread?.name ?? m.dName ?? "", text);
  const tag = m.mentions?.some((x) => x.uid === MENTION_ALL) ? " nhắc cả nhóm: " : m.mentions?.some((x) => x.uid === m.accountId) ? " nhắc đến bạn: " : ": ";
  return notify(`Nhóm: ${thread.name ?? ""}`, `${m.dName ?? ""}${tag}${text}`);
}

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<string>();
  const [qr, setQr] = useState<Qr>();
  // bumped per account on "contacts" events so the open list refetches
  const [ticks, setTicks] = useState<Record<string, number>>({});
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [error, setError] = useState<string>();
  const [view, setView] = useState<"chat" | "contacts" | "starred" | "todos">("chat");
  const [target, setTarget] = useState<ChatTarget>();
  // userId whose "Thông tin tài khoản" is open; the account's own id opens its own profile
  const [profileOf, setProfileOf] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // "account:thread" open on screen, read by the socket listener registered once
  const open = useRef<string | undefined>(undefined);

  const loadAccounts = () =>
    api<Account[]>("/accounts")
      .then((list) => {
        setAccounts(list);
        setSelected((s) => (list.some((a) => a.id === s) ? s : list[0]?.id));
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    loadAccounts();
    return onEvent((e) => {
      if (e.type === "account") setAccounts((list) => list.map((a) => (a.id === e.id ? { ...a, status: e.status } : a)));
      else if (e.type === "profile") setAccounts((list) => list.map((a) => (a.id === e.id ? { ...a, name: e.name, avatar: e.avatar } : a)));
      else if (e.type === "message") notifyMessage(e.message, open.current).catch(() => {});
      else if (e.type === "contacts") setTicks((t) => ({ ...t, [e.accountId]: (t[e.accountId] ?? 0) + 1 }));
      else if (e.type === "qr") setQr({ step: "scan", image: e.image });
      else if (e.type === "qr-scanned") setQr({ step: "scanned", name: e.name, avatar: e.avatar });
      else if (e.type === "qr-failed") setQr({ step: "failed" });
      else if (e.type === "qr-done") {
        setQr(undefined);
        loadAccounts().then(() => setSelected(e.id));
      }
    });
  }, []);

  const startQr = () => {
    setQr({ step: "loading" });
    api("/accounts/qr", "POST").catch((e) => setError(e.message));
  };
  const closeQr = () => {
    setQr(undefined);
    api("/accounts/qr", "DELETE").catch(() => {});
  };

  // PC's activity heartbeat: the open account is in the foreground while the window has focus
  useEffect(() => {
    if (!selected) return;
    const report = (foreground: boolean) => api(`/accounts/${selected}/presence`, "PUT", { foreground }).catch(() => {});
    const update = () => report(document.hasFocus() && document.visibilityState === "visible");
    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
      report(false);
    };
  }, [selected]);

  const account = accounts.find((a) => a.id === selected);
  open.current = account && view === "chat" && target ? `${account.id}:${target.threadId}` : undefined;
  const run = (p: Promise<unknown>) => p.catch((e) => setError(e.message));

  return (
    <div className="flex h-screen text-sm">
      <nav className="flex w-[68px] flex-col items-center gap-2.5 overflow-y-auto bg-primary py-3.5">
        {accounts.map((a) => (
          <button
            key={a.id}
            className={cn("relative rounded-full border-2 border-transparent p-0.5", a.id === selected && "border-white")}
            title={a.name}
            onClick={() => (setSelected(a.id), setTarget(undefined), setConfirmLogout(false), setProfileOf(undefined))}
          >
            <Avatar src={a.avatar} name={a.name} size={44} />
            <span className={cn("absolute right-0.5 bottom-0.5 size-3 rounded-full border-2 border-primary", STATUS_DOT[a.status])} />
          </button>
        ))}
        <Button
          variant="ghost"
          className="size-11 rounded-full border-2 border-dashed border-white/70 text-white hover:bg-white/15 hover:text-white"
          title="Thêm tài khoản"
          onClick={startQr}
        >
          <PlusIcon className="size-5" />
        </Button>
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="cursor-pointer bg-red-50 px-4 py-2 text-red-700" onClick={() => setError(undefined)}>
            {error}
          </div>
        )}
        {account ? (
          <>
            <header className="flex items-center gap-3 border-b px-4 py-3">
              <button title="Thông tin tài khoản" onClick={() => setProfileOf(account.id)}>
                <Avatar src={account.avatar} name={account.name} size={40} />
              </button>
              <div className="min-w-0 flex-1">
                <button className="text-base font-semibold hover:underline" onClick={() => setProfileOf(account.id)}>
                  {account.name}
                </button>
                <div
                  className={cn(
                    "text-xs text-muted-foreground",
                    account.status === "online" && "text-green-600",
                    account.status === "kicked" && "text-destructive",
                  )}
                >
                  {STATUS_TEXT[account.status]}
                </div>
              </div>
              <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
                <TabsList>
                  <TabsTrigger value="chat">Tin nhắn</TabsTrigger>
                  <TabsTrigger value="contacts">Danh bạ</TabsTrigger>
                  <TabsTrigger value="starred">Tin đánh dấu</TabsTrigger>
                  <TabsTrigger value="todos">Công việc</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="ghost" size="icon" title="Cài đặt" onClick={() => setSettingsOpen(true)}>
                <SettingsIcon />
              </Button>
              {account.status === "online" && (
                <Button variant="outline" onClick={() => run(api(`/accounts/${account.id}/contacts/sync`, "POST"))}>
                  Đồng bộ danh bạ
                </Button>
              )}
              {(account.status === "offline" || account.status === "kicked") && (
                <Button onClick={() => run(api(`/accounts/${account.id}`, "PATCH", { state: "active" }))}>Kết nối lại</Button>
              )}
              <Button
                variant="destructive"
                onClick={() => {
                  if (!confirmLogout) return setConfirmLogout(true);
                  setConfirmLogout(false);
                  run(api(`/accounts/${account.id}`, "DELETE").then(loadAccounts));
                }}
              >
                {confirmLogout ? "Bấm lần nữa để đăng xuất" : "Đăng xuất"}
              </Button>
            </header>
            {view === "chat" ? (
              <Chat key={account.id} accountId={account.id} online={account.status === "online"} target={target} onOpen={setTarget} onProfile={setProfileOf} />
            ) : view === "todos" ? (
              <Todos key={account.id} accountId={account.id} online={account.status === "online"} onOpen={(t) => (setTarget(t), setView("chat"))} />
            ) : view === "starred" ? (
              <Starred key={account.id} accountId={account.id} onOpen={(t) => (setTarget(t), setView("chat"))} />
            ) : (
              <Contacts
                key={account.id}
                accountId={account.id}
                online={account.status === "online"}
                tick={ticks[account.id] ?? 0}
                onChat={(t) => (setTarget(t), setView("chat"))}
                onProfile={setProfileOf}
              />
            )}
          </>
        ) : (
          <div className="m-auto flex flex-col items-center gap-3">
            <p>Chưa có tài khoản nào.</p>
            <Button onClick={startQr}>Đăng nhập bằng mã QR</Button>
          </div>
        )}
      </main>

      {account && profileOf && (
        <ProfileDialog
          key={profileOf}
          accountId={account.id}
          userId={profileOf}
          onClose={() => setProfileOf(undefined)}
          onChat={(t) => (setProfileOf(undefined), setTarget(t), setView("chat"))}
        />
      )}

      {account && settingsOpen && (
        <SettingsDialog key={account.id} accountId={account.id} online={account.status === "online"} onProfile={setProfileOf} onClose={() => setSettingsOpen(false)} />
      )}

      <Dialog open={!!qr} onOpenChange={(open) => !open && closeQr()}>
        <DialogContent aria-describedby={undefined} className="flex w-[340px] flex-col items-center gap-2.5 p-6 text-center">
          <DialogTitle>Thêm tài khoản Zalo</DialogTitle>
          {qr?.step === "loading" && <p className="text-xs text-muted-foreground">Đang lấy mã QR…</p>}
          {qr?.step === "scan" && (
            <>
              <img className="size-60" src={`data:image/png;base64,${qr.image}`} alt="Mã QR đăng nhập" />
              <p className="text-xs text-muted-foreground">Mở Zalo trên điện thoại, quét mã để đăng nhập</p>
            </>
          )}
          {qr?.step === "scanned" && (
            <>
              <Avatar src={qr.avatar} name={qr.name} size={80} />
              <p className="font-semibold">{qr.name}</p>
              <p className="text-xs text-muted-foreground">Xác nhận đăng nhập trên điện thoại</p>
            </>
          )}
          {qr?.step === "failed" && (
            <>
              <p className="text-xs text-muted-foreground">Mã QR đã hết hạn hoặc bị từ chối.</p>
              <Button onClick={startQr}>Lấy mã mới</Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
