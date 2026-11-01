import "./app.css";
import { useEffect, useRef, useState } from "react";
import { api } from "@/core/http/api";
import { notify } from "@/core/tauri/native";
import { onEvent } from "@/core/websocket/events";
import type { Account, AccountStatus, ChatTarget, ConversationSettings, MessageRow, Thread } from "@/shared/types";
import { Chat } from "@/app/chat";
import { useThreads } from "@/app/chat/hooks/useThreads";
import { summary, unreadCount } from "@/app/chat/utils/chat.utils";
import { MENTION_ALL } from "@/shared/constants/text.constants";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { Contacts } from "@/app/contact";
import { ProfileDialog } from "@/app/profile";
import { Starred } from "@/app/starred";
import { SettingsDialog } from "@/app/settings";
import { Todos } from "@/app/todo";
import { BulkProgress, BulkSend } from "@/app/bulk-send";
import { CheckIcon, ChevronDownIcon, EllipsisIcon, InboxIcon, LogOutIcon, MoonIcon, PlusIcon, QrCodeIcon, RefreshCwIcon, Settings2Icon, SettingsIcon, SunIcon, UserIcon, WifiOffIcon } from "lucide-react";
import { ToolbarDialog } from "@/app/chat/components/toolbar/toolbar-editor";
import { VIEW_BAR, VIEW_TOOLS } from "@/app/chat/constants/toolbar.constants";
import { arrange, useLayout } from "@/shared/hooks/use-toolbar";
import { useTheme } from "@/shared/hooks/use-theme";
import { accountTag } from "@/shared/components/account-tag";
import { ErrorBanner } from "@/shared/components/error-banner";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/utils/shadcn";

type Qr = { step: "loading" } | { step: "scan"; image: string } | { step: "scanned"; name: string; avatar: string } | { step: "failed" };

// short, under the account name; the banner below the header explains offline / kicked
const STATUS_TEXT: Record<AccountStatus, string> = {
  online: "Đang hoạt động",
  connecting: "Đang kết nối…",
  offline: "Mất kết nối",
  kicked: "Đã bị ngắt",
};
const DISCONNECTED: Partial<Record<AccountStatus, string>> = {
  offline: "Mất kết nối với Zalo. Tin nhắn mới sẽ không đến cho tới khi kết nối lại.",
  kicked: "Tài khoản đang mở trên Zalo Web/PC khác nên đã bị ngắt ở đây.",
};
const STATUS_DOT: Record<AccountStatus, string> = { online: "bg-green-500", connecting: "bg-amber-500", offline: "bg-gray-400", kicked: "bg-red-500" };
// selected = ALL: "Tất cả", every account's conversations in one list
const ALL = "*";

const badge = (n: number) =>
  n > 0 && (
    <span className="absolute -top-1 -right-1.5 min-w-5 rounded-full border-2 border-sidebar bg-red-500 px-1 text-[10px] leading-4 font-bold text-white">{n > 99 ? "99+" : n}</span>
  );

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
  const [view, setView] = useState<"chat" | "contacts" | "starred" | "todos" | "bulk">("chat");
  // Zalo turns To-Do on per account (no To-Do: no "Công việc", no "Giao việc"); read as each account comes online,
  // kept while it's offline
  const [todoOn, setTodoOn] = useState<Record<string, boolean>>({});
  const onlineIds = accounts.filter((a) => a.status === "online").map((a) => a.id).join();
  useEffect(() => {
    for (const id of onlineIds.split(",").filter(Boolean))
      api<{ enabled: boolean }>(`/accounts/${id}/todos/enabled`)
        .then((r) => setTodoOn((m) => ({ ...m, [id]: r.enabled })))
        .catch(() => {});
  }, [onlineIds]);
  const layout = useLayout(VIEW_BAR);
  const { isDark, toggle: toggleTheme } = useTheme();
  const [customizing, setCustomizing] = useState(false);
  const [target, setTarget] = useState<ChatTarget>();
  // userId whose "Thông tin tài khoản" is open; the account's own id opens its own profile
  const [profileOf, setProfileOf] = useState<string>();
  // the account a profile was opened from (a merged list's row), else the open conversation's
  const [profileIn, setProfileIn] = useState<string>();
  const openProfile = (userId: string, accountId?: string) => (setProfileOf(userId), setProfileIn(accountId));
  const [settingsOpen, setSettingsOpen] = useState(false);
  // "account:thread" open on screen, read by the socket listener registered once
  const open = useRef<string | undefined>(undefined);
  const { threads, settings } = useThreads(accounts.map((a) => a.id));
  const unread = (id: string) => unreadCount(threads[id], settings[id]);

  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const [sidebarScrollUp, setSidebarScrollUp] = useState(false);
  const [sidebarScrollDown, setSidebarScrollDown] = useState(false);

  const updateSidebarScroll = () => {
    const el = sidebarScrollRef.current;
    if (!el) return;
    setSidebarScrollUp(el.scrollTop > 4);
    setSidebarScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  };

  useEffect(() => {
    updateSidebarScroll();
  }, [accounts.length]);

  const loadAccounts = () =>
    api<Account[]>("/accounts")
      .then((list) => {
        setAccounts(list);
        setSelected((s) => ((s === ALL && list.length > 1) || list.some((a) => a.id === s) ? s : list[0]?.id));
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

  // PC's activity heartbeat: the open account, or every account on "Tất cả", is in the foreground while the window has focus
  const foreground = selected === ALL ? accounts.map((a) => a.id).join() : (selected ?? "");
  const shownNow = useRef(foreground);
  shownNow.current = foreground;
  useEffect(() => {
    if (!foreground) return;
    const ids = foreground.split(",");
    const report = (fg: boolean, list = ids) => list.forEach((id) => api(`/accounts/${id}/presence`, "PUT", { foreground: fg }).catch(() => {}));
    const update = () => report(document.hasFocus() && document.visibilityState === "visible");
    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
      // accounts still on screen keep their state: a late "false" could land after the next effect's "true"
      report(false, ids.filter((id) => !shownNow.current.split(",").includes(id)));
    };
  }, [foreground]);

  const account = accounts.find((a) => a.id === selected);
  const all = selected === ALL;
  // the account the open conversation belongs to (on "Tất cả", the one it was opened from)
  const chatAccount = target?.accountId ?? account?.id;
  open.current = chatAccount && view === "chat" && target ? `${chatAccount}:${target.threadId}` : undefined;
  const run = (p: Promise<unknown>) => p.catch((e) => setError(e.message));
  // the accounts on screen: the open one, or every account on "Tất cả" (lists merged, rows tagged)
  const shown = account ? [account] : all ? accounts : [];
  const tagOf = all ? (id: string) => accountTag(accounts, id) : undefined;
  const profileAccount = profileIn ?? chatAccount;
  // rows of contacts, starred and todos carry their account: the conversation opens as that account
  const openChat = (t: ChatTarget) => (setTarget(t), setView("chat"));

  // the top bar's views as this device arranged them (Cài đặt → Thanh công cụ); "Công việc" where Zalo has To-Do on
  const views = arrange(VIEW_TOOLS, layout).filter((t) => t.id !== "todos" || shown.some((a) => todoOn[a.id]));
  const barViews = views.filter((t) => t.place === "bar");
  const menuViews = views.filter((t) => t.place === "menu");
  const menuView = menuViews.find((t) => t.id === view);
  // the open view hidden (or not offered by this account) goes back to the conversations
  const viewGone = !views.some((t) => t.id === view && t.place !== "hidden");
  useEffect(() => {
    if (viewGone) setView("chat");
  }, [viewGone]);

  return (
    <div className="flex h-screen text-sm">
      <nav className="flex w-[68px] shrink-0 flex-col border-r bg-sidebar select-none">
        {/* pinned "Tất cả" button at top if multi-account */}
        {accounts.length > 1 && (
          <div className="flex flex-col items-center pt-3 pb-2.5 shrink-0 border-b border-border/40">
            <button
              className={cn("relative rounded-[14px] ring-offset-2 ring-offset-sidebar cursor-pointer transition-transform active:scale-95", all && "ring-2 ring-primary")}
              title="Tất cả tài khoản"
              onClick={() => (setSelected(ALL), setTarget(undefined), setProfileOf(undefined))}
            >
              {all && <span className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-primary transition-all duration-200" />}
              <span className={cn("grid size-11 place-items-center rounded-[14px] bg-muted text-muted-foreground transition-colors hover:text-foreground", all && "bg-primary/10 text-primary")}>
                <InboxIcon className="size-5" />
              </span>
              {badge(accounts.reduce((n, a) => n + unread(a.id), 0))}
            </button>
          </div>
        )}

        {/* accounts scroll smoothly with top/bottom fade hints without scrollbar clipping */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {sidebarScrollUp && (
            <div className="pointer-events-none absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-sidebar to-transparent z-10" />
          )}
          <div
            ref={sidebarScrollRef}
            onScroll={updateSidebarScroll}
            className="flex min-h-0 flex-1 flex-col items-center gap-2.5 overflow-y-auto py-2.5 scrollbar-none"
          >
            {accounts.map((a) => {
              const isSelected = a.id === selected;
              return (
                <button
                  key={a.id}
                  className={cn("relative rounded-full ring-offset-2 ring-offset-sidebar shrink-0 cursor-pointer transition-transform active:scale-95", isSelected && "ring-2 ring-primary")}
                  title={`${a.name} · ${STATUS_TEXT[a.status]}`}
                  onClick={() => (setSelected(a.id), setTarget(undefined), setProfileOf(undefined))}
                >
                  {isSelected && <span className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-primary transition-all duration-200" />}
                  <Avatar src={a.avatar} name={a.name} size={44} />
                  <span className={cn("absolute right-0 bottom-0 size-3 rounded-full border-2 border-sidebar", STATUS_DOT[a.status])} />
                  {badge(unread(a.id))}
                </button>
              );
            })}
            <Button
              variant="ghost"
              className="size-11 rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:bg-primary/5 hover:text-primary shrink-0 cursor-pointer"
              title="Thêm tài khoản"
              onClick={startQr}
            >
              <PlusIcon className="size-5" />
            </Button>
          </div>
          {sidebarScrollDown && (
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-sidebar to-transparent z-10" />
          )}
        </div>
        {accounts.length > 0 && (
          // settings and everything about an account, as Zalo PC's gear at the bottom of its bar
          <div className="flex justify-center border-t py-3 shrink-0">
            <DropdownMenu onOpenChange={(o) => !o && setConfirmLogout(false)}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="size-11 rounded-[14px] text-muted-foreground hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
                  title="Cài đặt"
                >
                  <SettingsIcon className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-60">
                {account ? (
                  <>
                    <DropdownMenuLabel className="truncate">{account.name}</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => openProfile(account.id, account.id)}>
                      <UserIcon /> Thông tin tài khoản
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                      <SettingsIcon /> Cài đặt
                    </DropdownMenuItem>
                    {account.status === "online" && (
                      <DropdownMenuItem onSelect={() => run(api(`/accounts/${account.id}/contacts/sync`, "POST"))}>
                        <RefreshCwIcon /> Đồng bộ danh bạ
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={toggleTheme}>
                      {isDark ? <SunIcon className="size-4 text-amber-400" /> : <MoonIcon className="size-4" />}
                      <span>Giao diện: {isDark ? "Tối (Dark)" : "Sáng (Light)"}</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={(e) => {
                        // the first click arms it and keeps the menu open, the second logs out
                        if (!confirmLogout) return e.preventDefault(), setConfirmLogout(true);
                        run(api(`/accounts/${account.id}`, "DELETE").then(loadAccounts));
                      }}
                    >
                      <LogOutIcon /> {confirmLogout ? "Bấm lần nữa để đăng xuất" : "Đăng xuất"}
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    {/* "Tất cả": settings belong to one account, so picking one switches to it */}
                    <DropdownMenuLabel>Cài đặt cho tài khoản</DropdownMenuLabel>
                    <div className="max-h-72 overflow-y-auto space-y-0.5">
                      {accounts.map((a) => (
                        <DropdownMenuItem key={a.id} onSelect={() => (setSelected(a.id), setTarget(undefined), setSettingsOpen(true))}>
                          <Avatar src={a.avatar} name={a.name} size={20} />
                          <span className="truncate">{a.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={toggleTheme}>
                      {isDark ? <SunIcon className="size-4 text-amber-400" /> : <MoonIcon className="size-4" />}
                      <span>Giao diện: {isDark ? "Tối (Dark)" : "Sáng (Light)"}</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        {error && <ErrorBanner text={error} onClose={() => setError(undefined)} />}
        {shown.length ? (
          <>
            {/* one slim row: the views on the left, whose they are on the right */}
            <header className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
              {/* the views as the user arranged them: tabs, the rest grouped under "Thêm"; right click to customize */}
              <div className="flex min-w-0 items-center gap-1" onContextMenu={(e) => (e.preventDefault(), setCustomizing(true))}>
                {barViews.length > 0 && (
                  <Tabs value={barViews.some((t) => t.id === view) ? view : ""} onValueChange={(v) => setView(v as typeof view)}>
                    <TabsList>
                      {barViews.map((t) => (
                        <TabsTrigger key={t.id} value={t.id} className="px-2.5">
                          {t.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn("text-muted-foreground data-[state=open]:bg-muted", menuView && "bg-muted font-medium text-foreground")}
                      title="Thêm"
                    >
                      {/* a view picked from the menu shows here, so it's clear where you are */}
                      {menuViews.length ? (
                        <>
                          {menuView?.label ?? "Thêm"}
                          <ChevronDownIcon />
                        </>
                      ) : (
                        <EllipsisIcon />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {menuViews.map((t) => (
                      <DropdownMenuItem key={t.id} onSelect={() => setView(t.id as typeof view)}>
                        <t.icon /> {t.label}
                        {t.id === view && <CheckIcon className="ml-auto" />}
                      </DropdownMenuItem>
                    ))}
                    {menuViews.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem onSelect={() => setCustomizing(true)}>
                      <Settings2Icon /> Tùy chỉnh thanh công cụ
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {account ? (
                  <button
                    className="flex min-w-0 items-center gap-2 rounded-md py-1 pr-1 pl-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                    title={`Thông tin tài khoản · ${STATUS_TEXT[account.status]}`}
                    onClick={() => openProfile(account.id, account.id)}
                  >
                    <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[account.status])} />
                    <span className="truncate">{account.name}</span>
                    <Avatar src={account.avatar} name={account.name} size={24} />
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    <InboxIcon className="size-4 text-primary" />
                    Tất cả tài khoản · {accounts.filter((a) => a.status === "online").length}/{accounts.length} đang hoạt động
                  </span>
                )}

                <div className="h-4 w-px bg-border/60" />

                <Button
                  variant="ghost"
                  size="icon-xs"
                  title={isDark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
                  onClick={toggleTheme}
                  className="size-7 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                >
                  {isDark ? (
                    <SunIcon className="size-3.5 text-amber-400 fill-amber-400/20" />
                  ) : (
                    <MoonIcon className="size-3.5" />
                  )}
                </Button>

                <BulkProgress accounts={accounts} onOpen={() => setView("bulk")} />
              </div>
            </header>
            {account && DISCONNECTED[account.status] && (
              <div className="flex items-center gap-2.5 border-b bg-amber-50 px-4 py-2 text-[13px] text-amber-900">
                <WifiOffIcon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">{DISCONNECTED[account.status]}</span>
                <Button size="sm" onClick={() => run(api(`/accounts/${account.id}`, "PATCH", { state: "active" }))}>
                  Kết nối lại
                </Button>
              </div>
            )}
            {view === "chat" ? (
              <Chat
                key={account?.id ?? ALL}
                accounts={account ? [account] : accounts}
                threads={threads}
                settings={settings}
                todo={todoOn}
                target={target}
                onOpen={setTarget}
                onProfile={openProfile}
              />
            ) : view === "todos" ? (
              <Todos key={account?.id ?? ALL} accounts={shown} tag={tagOf} onOpen={openChat} />
            ) : view === "bulk" ? (
              <BulkSend key={account?.id ?? ALL} accounts={shown} tag={tagOf} onOpen={openChat} />
            ) : view === "starred" ? (
              <Starred key={account?.id ?? ALL} accounts={shown} tag={tagOf} onOpen={openChat} />
            ) : (
              <Contacts key={account?.id ?? ALL} accounts={shown} tag={tagOf} tick={ticks} onChat={openChat} onProfile={openProfile} />
            )}
          </>
        ) : (
          <div className="m-auto flex max-w-xs flex-col items-center gap-3 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <QrCodeIcon className="size-7" />
            </span>
            <div>
              <p className="text-base font-semibold">Chưa có tài khoản nào</p>
              <p className="mt-1 text-muted-foreground">Quét mã QR bằng Zalo trên điện thoại để thêm tài khoản đầu tiên.</p>
            </div>
            <Button size="lg" onClick={startQr}>
              Đăng nhập bằng mã QR
            </Button>
          </div>
        )}
      </main>

      {profileAccount && profileOf && (
        <ProfileDialog
          key={profileOf}
          accountId={profileAccount}
          userId={profileOf}
          onClose={() => setProfileOf(undefined)}
          onChat={(t) => (setProfileOf(undefined), setTarget({ ...t, accountId: profileAccount }), setView("chat"))}
        />
      )}

      {customizing && <ToolbarDialog onClose={() => setCustomizing(false)} />}

      {account && settingsOpen && (
        <SettingsDialog key={account.id} accountId={account.id} online={account.status === "online"} onProfile={(userId) => openProfile(userId, account.id)} onClose={() => setSettingsOpen(false)} />
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
