import { useEffect, useRef, useState } from "react";
import { NO_SETTINGS } from "@/app/chat/constants/chat.constants";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import type { ChatTarget, ConversationSettings, MyCloud, Thread } from "@/shared/types";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { ConversationMenuItems } from "@/app/chat/components/thread/conversation-menu-items";
import { DeleteDialog } from "@/app/chat/components/dialogs/delete-dialog";
import { HiddenSettings } from "@/app/chat/components/dialogs/hidden-settings";
import { HideDialog } from "@/app/chat/components/dialogs/hide-dialog";
import { LabelManager } from "@/app/chat/components/dialogs/label-manager";
import { RichText } from "@/app/chat/components/message/rich-text";
import { GlobalSearch } from "@/app/chat/components/search/global-search";
import { labelOf, time, summary } from "@/app/chat/utils/chat.utils";
import { Conversation } from "@/app/chat/components/conversation/conversation";
import { BellOffIcon, EllipsisIcon, LockIcon, PinIcon } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils/shadcn";

// Zalo PC's conversation list filters: everything, "Chưa đọc", or one "Phân loại"
type ListFilter = "all" | "unread" | number;

export function Chat({
  accountId,
  online,
  target,
  onOpen,
  onProfile,
}: {
  accountId: string;
  online: boolean;
  target?: ChatTarget;
  // undefined closes the open conversation (deleted)
  onOpen: (t?: ChatTarget) => void;
  onProfile: (userId: string) => void;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [settings, setSettings] = useState<ConversationSettings>(NO_SETTINGS);
  // "Cloud của tôi", known once connected
  const [cloud, setCloud] = useState<MyCloud>();
  useEffect(() => {
    if (online)
      api<MyCloud>(`/accounts/${accountId}/cloud`)
        .then(setCloud)
        .catch(() => {});
  }, [online]);
  const [search, setSearch] = useState("");
  // the search box is focused or holds text: results replace the conversation list, as on PC
  const [searching, setSearching] = useState(false);
  // the info panel stays open across conversations, as on Zalo PC
  const [info, setInfo] = useState(false);
  // "Ưu tiên" / "Khác" and the list filter
  const [section, setSection] = useState<"priority" | "other">("priority");
  const [filter, setFilter] = useState<ListFilter>("all");
  // the row whose menu is open (its "…" button or a right click)
  const [menuFor, setMenuFor] = useState<string>();
  const [dialog, setDialog] = useState<{ kind: "hide" | "delete" | "labels" | "hiddenSettings"; thread?: Thread }>();
  const [error, setError] = useState<string>();
  const run = (p: Promise<unknown>) => void p.catch((e) => setError(e.message));

  useEffect(() => {
    const load = () => api<Thread[]>(`/accounts/${accountId}/threads`).then(setThreads).catch(() => {});
    const loadSettings = () => api<ConversationSettings>(`/accounts/${accountId}/conversations`).then(setSettings).catch(() => {});
    load();
    loadSettings();
    // sync can fire many "threads" events in a row: refetch at most every 300ms
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onEvent((e) => {
      if (e.type === "threads" && e.accountId === accountId && !timer)
        timer = setTimeout(() => {
          timer = undefined;
          load();
        }, 300);
      else if (e.type === "conversations" && e.accountId === accountId) loadSettings();
    });
    return () => (off(), clearTimeout(timer));
  }, [accountId]);

  // PC clears an unread mark when the conversation is opened, but not one set while it is already open
  const checked = useRef<string>(undefined);
  useEffect(() => {
    if (!target || checked.current === target.threadId || settings === NO_SETTINGS) return;
    checked.current = target.threadId;
    if (settings.unread.includes(target.threadId)) run(api(`/accounts/${accountId}/conversations/${target.threadId}/unread`, "PUT", { isGroup: target.isGroup, unread: false }));
  }, [target?.threadId, settings]);

  const pinned = new Set(settings.pinned);
  const marked = new Set(settings.unread);
  const archived = new Set(settings.archived);
  // hidden conversations stay out of the list (one opened with the PIN stays while open)
  const hidden = new Set(settings.hidden.filter((id) => id !== target?.threadId));
  const label = typeof filter === "number" ? settings.labels.find((l) => l.id === filter) : undefined;
  const shown = threads
    .filter((t) => !hidden.has(t.threadId) && archived.has(t.threadId) === (section === "other"))
    .filter((t) => (filter === "unread" ? t.unread > 0 || marked.has(t.threadId) : label ? label.conversations.includes(t.threadId) : true))
    // pinned first; the sort is stable, so each part stays newest first
    .sort((a, b) => Number(pinned.has(b.threadId)) - Number(pinned.has(a.threadId)));
  const tab = (key: typeof section, text: string) => (
    <button className={cn("border-b-2 border-transparent px-1 pb-1.5 text-[13px]", section === key ? "border-primary font-semibold text-primary" : "text-muted-foreground")} onClick={() => setSection(key)}>
      {text}
    </button>
  );
  return (
    <div className="flex min-h-0 flex-1">
      {/* gives way to the conversation (min 288px) when the info panel opens in a narrow window */}
      <aside className="flex w-80 min-w-0 flex-col border-r">
        <div className="flex items-center gap-1.5 p-3">
          <Input
            placeholder="Tìm kiếm"
            value={search}
            onFocus={() => setSearching(true)}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setSearch(""), setSearching(false), e.currentTarget.blur())}
          />
          {searching && (
            <Button variant="ghost" size="sm" onClick={() => (setSearch(""), setSearching(false))}>
              Đóng
            </Button>
          )}
        </div>
        {error && (
          <div className="mx-3 mb-2 cursor-pointer rounded bg-red-50 px-2 py-1 text-xs text-red-700" onClick={() => setError(undefined)}>
            {error}
          </div>
        )}
        {searching ? (
          <GlobalSearch accountId={accountId} q={search} onOpen={onOpen} onClose={() => (setSearch(""), setSearching(false))} />
        ) : (
          <>
            <div className="flex items-center gap-3 border-b px-3">
              {tab("priority", "Ưu tiên")}
              {tab("other", "Khác")}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="xs" className="mb-1 ml-auto">
                    {filter === "unread" ? "Chưa đọc" : (label?.text ?? "Phân loại")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  <DropdownMenuItem onSelect={() => setFilter("all")}>Tất cả</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setFilter("unread")}>Chưa đọc</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {settings.labels.map((l) => (
                    <DropdownMenuItem key={l.id} onSelect={() => setFilter(l.id)}>
                      <span className="size-3 shrink-0 rounded-sm" style={{ background: l.color }} /> <span className="truncate">{l.text}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onSelect={() => setDialog({ kind: "labels" })}>Quản lý thẻ phân loại</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setDialog({ kind: "hiddenSettings" })}>Thiết lập ẩn trò chuyện</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex-1 overflow-y-auto">
              {shown.map((t) => {
                const tag = labelOf(settings, t.threadId);
                const dot = !t.unread && marked.has(t.threadId);
                return (
                  <div
                    key={t.threadId}
                    className={cn("group/row relative flex items-center hover:bg-muted", t.threadId === target?.threadId && "bg-primary/10 hover:bg-primary/10")}
                    onContextMenu={(e) => (e.preventDefault(), setMenuFor(t.threadId))}
                  >
                    <button className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left" onClick={() => onOpen({ threadId: t.threadId, isGroup: t.isGroup, name: t.name, avatar: t.avatar })}>
                      <Avatar src={t.avatar} name={t.name ?? "?"} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-2">
                          <span className={cn("truncate inline-flex items-center gap-1", (t.unread || dot) && "font-semibold")}>
                            {t.name ?? t.threadId}
                            {t.e2ee && (
                              <span title="Đã mã hóa đầu cuối" className="inline-flex items-center">
                                <LockIcon className="size-3 text-emerald-600 shrink-0" />
                              </span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground [&_svg]:size-3">
                            {t.threadId in settings.muted && <BellOffIcon />}
                            {pinned.has(t.threadId) && <PinIcon />}
                            {time(t.messageTime)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn("truncate text-[13px]", t.unread || dot ? "font-semibold" : "text-muted-foreground")}>
                            {tag && <span className="mr-1 inline-block size-2.5 rounded-sm align-middle" title={tag.text} style={{ background: tag.color }} />}
                            {t.fromUid === accountId ? "Bạn: " : t.isGroup && t.dName ? `${t.dName}: ` : ""}
                            <RichText text={summary(t.msgType, t.content)} />
                          </span>
                          {t.unread > 0 && <Badge className={cn("text-white", t.threadId in settings.muted ? "bg-gray-400" : "bg-red-500")}>{t.unread > 99 ? "99+" : t.unread}</Badge>}
                          {/* a mark shows a dot without a count, grey when muted */}
                          {dot && <span className={cn("size-2.5 shrink-0 rounded-full", t.threadId in settings.muted ? "bg-gray-400" : "bg-red-500")} />}
                        </div>
                      </div>
                    </button>
                    <DropdownMenu open={menuFor === t.threadId} onOpenChange={(open) => setMenuFor(open ? t.threadId : undefined)}>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" className={cn("absolute top-2 right-2 bg-white/80", menuFor !== t.threadId && "invisible group-hover/row:visible")} title="Thêm">
                          <EllipsisIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-56" align="end">
                        <ConversationMenuItems
                          accountId={accountId}
                          threadId={t.threadId}
                          isGroup={t.isGroup}
                          unread={t.unread > 0}
                          settings={settings}
                          run={run}
                          onDialog={(kind) => setDialog({ kind, thread: t })}
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
              {!shown.length && (
                <p className="p-2 text-center text-xs text-muted-foreground">
                  {section === "other" && filter === "all" ? "Tách riêng các trò chuyện không ưu tiên" : threads.length ? "Không có hội thoại" : "Chưa có hội thoại"}
                </p>
              )}
            </div>
          </>
        )}
      </aside>
      {dialog?.kind === "hide" && dialog.thread && (
        <HideDialog
          accountId={accountId}
          threadId={dialog.thread.threadId}
          isGroup={dialog.thread.isGroup}
          name={dialog.thread.name ?? dialog.thread.threadId}
          hasPin={settings.hasPin}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "delete" && dialog.thread && (
        <DeleteDialog
          accountId={accountId}
          threadId={dialog.thread.threadId}
          onDeleted={() => dialog.thread!.threadId === target?.threadId && onOpen(undefined)}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "labels" && <LabelManager accountId={accountId} labels={settings.labels} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === "hiddenSettings" && <HiddenSettings accountId={accountId} hasPin={settings.hasPin} onClose={() => setDialog(undefined)} />}
      {target ? (
        <Conversation
          key={target.threadId}
          accountId={accountId}
          online={online}
          target={target}
          threads={threads}
          settings={settings}
          info={info}
          cloud={cloud}
          onInfo={setInfo}
          onOpen={onOpen}
          onProfile={onProfile}
        />
      ) : (
        <div className="m-auto text-xs text-muted-foreground">Chọn một hội thoại để bắt đầu</div>
      )}
    </div>
  );
}
