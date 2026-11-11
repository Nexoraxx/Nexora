import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { NO_SETTINGS } from "@/app/chat/constants/chat.constants";
import { api } from "@/core/http/api";
import type { Account, ChatTarget, ConversationSettings, MessageRow, MyCloud, Thread } from "@/shared/types";
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
import { BellOffIcon, ChevronDownIcon, EllipsisIcon, ListFilterIcon, LockIcon, MessagesSquareIcon, PinIcon, StarIcon } from "lucide-react";
import { accountTag } from "@/shared/components/account-tag";
import { ErrorBanner } from "@/shared/components/error-banner";
import { SearchInput } from "@/shared/components/search-input";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/utils/shadcn";
import { fold } from "@/shared/utils/text.utils";

// Zalo PC's conversation list filters: everything, "Chưa đọc", "Tin đánh dấu", or one "Phân loại"
type ListFilter = "all" | "unread" | "starred" | number;
// a conversation of one of the shown accounts
type Row = Thread & { accountId: string };

export function Chat({
  accounts,
  threads,
  settings: settingsBy,
  todo,
  target,
  onOpen,
  onProfile,
}: {
  // the open account, or every account for "Tất cả": rows then carry their account's tag
  accounts: Account[];
  // by account id (useThreads)
  threads: Record<string, Thread[]>;
  settings: Record<string, ConversationSettings>;
  // by account id: Zalo has To-Do on for it ("Giao việc")
  todo: Record<string, boolean>;
  target?: ChatTarget;
  // undefined closes the open conversation (deleted)
  onOpen: (t?: ChatTarget) => void;
  onProfile: (userId: string) => void;
}) {
  const all = accounts.length > 1;
  const settingsOf = (id: string) => settingsBy[id] ?? NO_SETTINGS;
  const tagOf = (id: string) => accountTag(accounts, id);
  // "Cloud của tôi" of each account, known once connected
  const [cloud, setCloud] = useState<Record<string, MyCloud>>({});
  const online = accounts.filter((a) => a.status === "online").map((a) => a.id);
  useEffect(() => {
    for (const id of online.filter((id) => !cloud[id]))
      api<MyCloud>(`/accounts/${id}/cloud`)
        .then((c) => setCloud((m) => ({ ...m, [id]: c })))
        .catch(() => {});
  }, [online.join()]);
  const [search, setSearch] = useState("");
  // the search box is focused or holds text: results replace the conversation list, as on PC
  // ("Tất cả" has no message search: it narrows the list to matching names instead)
  const [searching, setSearching] = useState(false);
  // the info panel stays open across conversations, as on Zalo PC
  const [info, setInfo] = useState(false);
  // "Ưu tiên" / "Khác" and the list filter
  const [section, setSection] = useState<"priority" | "other">("priority");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [starredRows, setStarredRows] = useState<(MessageRow & { starredAt: number })[]>();
  const [loadingStarred, setLoadingStarred] = useState(false);

  useEffect(() => {
    if (filter !== "starred") return;
    setLoadingStarred(true);
    const ids = accounts.map((a) => a.id);
    Promise.all(ids.map((id) => api<(MessageRow & { starredAt: number })[]>(`/accounts/${id}/starred`).catch(() => [])))
      .then((lists) => setStarredRows(lists.flat().sort((a, b) => b.starredAt - a.starredAt)))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingStarred(false));
  }, [filter, accounts.map((a) => a.id).join()]);
  // the row whose menu is open (its "…" button or a right click), as "account:thread"
  const [menuFor, setMenuFor] = useState<string>();
  const [dialog, setDialog] = useState<{ kind: "hide" | "delete" | "labels" | "hiddenSettings"; thread?: Row }>();
  const [error, setError] = useState<string>();
  const run = (p: Promise<unknown>) => void p.catch((e) => setError(e.message));

  // the account the open conversation is chatted from
  const targetAccount = target && (target.accountId ?? accounts[0].id);
  const isTarget = (t: Row) => t.threadId === target?.threadId && t.accountId === targetAccount;
  // what the rows do, behind a ref that keeps its identity: a row re-renders only when its own data changes
  const actions: RowActions = {
    open: onOpen,
    menu: setMenuFor,
    run,
    dialog: (kind, thread) => setDialog({ kind, thread }),
  };
  const act = useRef(actions);
  act.current = actions;

  // PC clears an unread mark when the conversation is opened, but not one set while it is already open
  const checked = useRef<string>(undefined);
  const targetSettings = targetAccount && settingsBy[targetAccount];
  useEffect(() => {
    if (!target || !targetSettings || checked.current === `${targetAccount}:${target.threadId}`) return;
    checked.current = `${targetAccount}:${target.threadId}`;
    if (targetSettings.unread.includes(target.threadId))
      run(api(`/accounts/${targetAccount}/conversations/${target.threadId}/unread`, "PUT", { isGroup: target.isGroup, unread: false }));
  }, [target?.threadId, targetAccount, targetSettings]);

  // labels belong to one account, so "Tất cả" filters by unread only
  const label = typeof filter === "number" ? settingsOf(accounts[0].id).labels.find((l) => l.id === filter) : undefined;
  const q = fold(search.trim());
  // recomputed only when its inputs change: typing in a conversation or opening a menu doesn't re-sort the list
  const shown = useMemo(() => {
    const pinned = new Map(accounts.map((a) => [a.id, new Set(settingsOf(a.id).pinned)]));
    const isPinned = (t: Row) => Number(pinned.get(t.accountId)?.has(t.threadId) ?? false);
    return (
      accounts
        .flatMap((a) => (threads[a.id] ?? []).map((t): Row => ({ ...t, accountId: a.id })))
        .filter((t) => {
          const s = settingsOf(t.accountId);
          // hidden conversations stay out of the list (one opened with the PIN stays while open)
          if (s.hidden.includes(t.threadId) && !isTarget(t)) return false;
          if (all && searching) return fold(t.name ?? "").includes(q);
          if (s.archived.includes(t.threadId) !== (section === "other")) return false;
          return filter === "unread" ? t.unread > 0 || s.unread.includes(t.threadId) : label ? label.conversations.includes(t.threadId) : true;
        })
        // newest first across accounts, then pinned first; the sort is stable, so each part stays newest first
        .sort((a, b) => b.messageTime - a.messageTime)
        .sort((a, b) => isPinned(b) - isPinned(a))
    );
  }, [accounts, threads, settingsBy, target?.threadId, targetAccount, all, searching, q, section, filter, label]);
  const dialogAccount = dialog?.thread?.accountId ?? accounts[0].id;
  const tab = (key: typeof section, text: string) => (
    <button
      className={cn("-mb-px border-b-2 border-transparent px-1 py-2 text-[13px] transition-colors", section === key ? "border-primary font-semibold text-primary" : "text-muted-foreground hover:text-foreground")}
      onClick={() => setSection(key)}
    >
      {text}
    </button>
  );
  return (
    <div className="flex min-h-0 flex-1">
      {/* gives way to the conversation (min 288px) when the info panel opens in a narrow window */}
      <aside className="flex w-80 min-w-0 flex-col border-r">
        <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
          <SearchInput
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
        {error && <ErrorBanner className="mx-3 mb-2 rounded-lg px-3" text={error} onClose={() => setError(undefined)} />}
        {searching && !all ? (
          <GlobalSearch accountId={accounts[0].id} q={search} onOpen={onOpen} onClose={() => (setSearch(""), setSearching(false))} />
        ) : (
          <>
            {!searching && (
              <div className="flex items-center gap-2 border-b px-3 h-10 shrink-0">
                {tab("priority", "Ưu tiên")}
                {tab("other", "Khác")}
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={filter === "starred" ? "Quay lại danh sách hội thoại" : "Tin đánh dấu"}
                    className={cn(
                      "size-7 rounded-lg text-muted-foreground transition-colors cursor-pointer",
                      filter === "starred" && "bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 hover:text-amber-600"
                    )}
                    onClick={() => setFilter((f) => (f === "starred" ? "all" : "starred"))}
                  >
                    <StarIcon className={cn("size-3.5", filter === "starred" && "fill-amber-500 text-amber-500")} />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="xs" className={cn("text-muted-foreground", filter !== "all" && filter !== "starred" && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary")}>
                        <ListFilterIcon />
                        <span className="max-w-24 truncate">
                          {filter === "unread"
                            ? "Chưa đọc"
                            : filter === "starred"
                            ? "Đánh dấu"
                            : (label?.text ?? (all ? "Tất cả" : "Phân loại"))}
                        </span>
                        <ChevronDownIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56">
                      <DropdownMenuItem onSelect={() => setFilter("all")}>Tất cả</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setFilter("unread")}>Chưa đọc</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setFilter("starred")} className="flex items-center gap-2">
                        <StarIcon className="size-3.5 text-amber-500 fill-amber-500" />
                        <span>Tin đánh dấu</span>
                      </DropdownMenuItem>
                      {!all && (
                        <>
                          <DropdownMenuSeparator />
                          {settingsOf(accounts[0].id).labels.map((l) => (
                            <DropdownMenuItem key={l.id} onSelect={() => setFilter(l.id)}>
                              <span className="size-3 shrink-0 rounded-sm" style={{ background: l.color }} /> <span className="truncate">{l.text}</span>
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuItem onSelect={() => setDialog({ kind: "labels" })}>Quản lý thẻ phân loại</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => setDialog({ kind: "hiddenSettings" })}>Thiết lập ẩn trò chuyện</DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )}
            {filter === "starred" ? (
              <div className="flex-1 overflow-y-auto px-1.5 py-1.5 space-y-1">
                {loadingStarred ? (
                  <div className="py-14 text-center text-xs text-muted-foreground">
                    Đang tải tin đánh dấu...
                  </div>
                ) : starredRows && starredRows.length === 0 ? (
                  <div className="py-14 px-4 text-center text-xs text-muted-foreground">
                    <StarIcon className="size-8 mx-auto mb-2 text-amber-500/30 stroke-[1.5]" />
                    <p className="font-medium text-foreground">Chưa có tin nhắn nào được đánh dấu</p>
                    <p className="text-[11px] mt-1 text-muted-foreground/80">Đánh dấu sao các tin quan trọng để xem lại nhanh tại đây.</p>
                  </div>
                ) : (
                  starredRows?.map((m) => {
                    const threadList = threads[m.accountId] ?? [];
                    const t = threadList.find((x) => x.threadId === m.threadId);
                    const isCurrent = target?.threadId === m.threadId && targetAccount === m.accountId && target?.msgId === m.msgId;
                    return (
                      <button
                        key={`${m.accountId}:${m.msgId}`}
                        type="button"
                        onClick={() =>
                          onOpen({
                            threadId: m.threadId,
                            isGroup: !!t?.isGroup,
                            name: t?.name ?? null,
                            avatar: t?.avatar ?? null,
                            msgId: m.msgId,
                            accountId: m.accountId,
                          })
                        }
                        className={cn(
                          "w-full flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all hover:bg-muted/60 active:scale-[0.99] cursor-pointer border border-transparent",
                          isCurrent ? "bg-primary/10 border-primary/20 shadow-xs" : "hover:border-border/60"
                        )}
                      >
                        <Avatar src={t?.avatar} name={t?.name ?? "?"} size={36} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="truncate font-semibold text-xs text-foreground">{t?.name ?? m.threadId}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <StarIcon className="size-3 text-amber-500 fill-amber-500" />
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {new Date(m.sendDttm).toLocaleDateString("vi", { day: "2-digit", month: "2-digit" })}
                              </span>
                            </div>
                          </div>
                          <p className="truncate text-xs text-muted-foreground/80 mt-0.5">
                            {m.fromUid === m.accountId ? "Bạn: " : m.dName ? `${m.dName}: ` : ""}
                            <RichText text={summary(m.msgType, m.content)} />
                          </p>
                          {all && <div className="mt-1">{tagOf(m.accountId)}</div>}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
              {shown.map((t) => {
                const key = `${t.accountId}:${t.threadId}`;
                return (
                  <ThreadItem
                    key={key}
                    t={t}
                    s={settingsOf(t.accountId)}
                    active={isTarget(t)}
                    menuOpen={menuFor === key}
                    accounts={all ? accounts : undefined}
                    act={act}
                  />
                );
              })}
              {!shown.length && accounts.some((a) => !threads[a.id]) ? (
                <ThreadSkeletons />
              ) : (
                !shown.length && (
                  <p className="px-6 py-10 text-center text-xs text-muted-foreground">
                    {!searching && section === "other" && filter === "all"
                      ? "Tách riêng các trò chuyện không ưu tiên"
                      : accounts.some((a) => threads[a.id]?.length)
                        ? "Không có hội thoại"
                        : "Chưa có hội thoại"}
                  </p>
                )
              )}
            </div>
            )}
          </>
        )}
      </aside>
      {dialog?.kind === "hide" && dialog.thread && (
        <HideDialog
          accountId={dialogAccount}
          threadId={dialog.thread.threadId}
          isGroup={dialog.thread.isGroup}
          name={dialog.thread.name ?? dialog.thread.threadId}
          hasPin={settingsOf(dialogAccount).hasPin}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "delete" && dialog.thread && (
        <DeleteDialog
          accountId={dialogAccount}
          threadId={dialog.thread.threadId}
          onDeleted={() => isTarget(dialog.thread!) && onOpen(undefined)}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "labels" && <LabelManager accountId={dialogAccount} labels={settingsOf(dialogAccount).labels} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === "hiddenSettings" && <HiddenSettings accountId={dialogAccount} hasPin={settingsOf(dialogAccount).hasPin} onClose={() => setDialog(undefined)} />}
      {target && targetAccount ? (
        <Conversation
          key={`${targetAccount}:${target.threadId}`}
          accountId={targetAccount}
          online={online.includes(targetAccount)}
          target={target}
          threads={threads[targetAccount] ?? []}
          settings={settingsOf(targetAccount)}
          info={info}
          cloud={cloud[targetAccount]}
          tag={all ? tagOf(targetAccount) : undefined}
          todo={!!todo[targetAccount]}
          onInfo={setInfo}
          // conversations opened from this one (a group, a profile's "Nhắn tin") use the same account
          onOpen={(t) => onOpen(t && { accountId: targetAccount, ...t })}
          onProfile={onProfile}
        />
      ) : (
        <div className="m-auto flex flex-col items-center gap-3 text-center text-muted-foreground">
          <span className="grid size-14 place-items-center rounded-2xl bg-muted">
            <MessagesSquareIcon className="size-7" />
          </span>
          <p>Chọn một hội thoại ở danh sách bên trái để bắt đầu</p>
        </div>
      )}
    </div>
  );
}

type RowActions = {
  open: (t: ChatTarget) => void;
  menu: (key: string | undefined) => void;
  run: (p: Promise<unknown>) => void;
  dialog: (kind: "hide" | "delete" | "labels" | "hiddenSettings", thread: Row) => void;
};
type ItemProps = {
  t: Row;
  s: ConversationSettings;
  active: boolean;
  menuOpen: boolean;
  // "Tất cả": every account, for the row's account tag
  accounts?: Account[];
  act: RefObject<RowActions>;
};

// rows are rebuilt ({ ...thread, accountId }) on every list computation: compared field by field
const sameItem = (a: ItemProps, b: ItemProps) =>
  (Object.keys(a) as (keyof ItemProps)[]).every((k) =>
    k === "t" ? (Object.keys(a.t) as (keyof Row)[]).every((f) => a.t[f] === b.t[f]) && Object.keys(a.t).length === Object.keys(b.t).length : a[k] === b[k],
  );

const ThreadItem = memo(function ThreadItem({ t, s, active, menuOpen, accounts, act }: ItemProps) {
  const key = `${t.accountId}:${t.threadId}`;
  const tag = labelOf(s, t.threadId);
  const dot = !t.unread && s.unread.includes(t.threadId);
  const muted = t.threadId in s.muted;
  return (
    <div
      className={cn("offscreen-skip group/row relative flex items-center rounded-lg hover:bg-muted", active && "bg-primary/10 hover:bg-primary/10")}
      onContextMenu={(e) => (e.preventDefault(), act.current.menu(key))}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left"
        onClick={() => act.current.open({ threadId: t.threadId, isGroup: t.isGroup, name: t.name, avatar: t.avatar, accountId: t.accountId })}
      >
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
              {muted && <BellOffIcon />}
              {s.pinned.includes(t.threadId) && <PinIcon />}
              {time(t.messageTime)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={cn("truncate text-[13px]", t.unread || dot ? "font-semibold" : "text-muted-foreground")}>
              {tag && <span className="mr-1 inline-block size-2.5 rounded-sm align-middle" title={tag.text} style={{ background: tag.color }} />}
              {t.fromUid === t.accountId ? "Bạn: " : t.isGroup && t.dName ? `${t.dName}: ` : ""}
              <RichText text={summary(t.msgType, t.content)} />
            </span>
            {accounts && <span className="ml-auto flex shrink-0">{accountTag(accounts, t.accountId)}</span>}
            {t.unread > 0 && <Badge className={cn("text-white", muted ? "bg-gray-400" : "bg-red-500")}>{t.unread > 99 ? "99+" : t.unread}</Badge>}
            {/* a mark shows a dot without a count, grey when muted */}
            {dot && <span className={cn("size-2.5 shrink-0 rounded-full", muted ? "bg-gray-400" : "bg-red-500")} />}
          </div>
        </div>
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={(open) => act.current.menu(open ? key : undefined)}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" className={cn("absolute top-2 right-2 bg-background shadow-xs", !menuOpen && "invisible group-hover/row:visible")} title="Thêm">
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end">
          <ConversationMenuItems
            accountId={t.accountId}
            threadId={t.threadId}
            isGroup={t.isGroup}
            unread={t.unread > 0}
            settings={s}
            run={(p) => act.current.run(p)}
            onDialog={(kind) => act.current.dialog(kind, t)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}, sameItem);

// the conversation list's shape while the first page loads: avatar, name and last-message lines of varied width
const SKELETON_ROWS = ["w-3/5", "w-2/5", "w-1/2", "w-3/4", "w-2/5", "w-3/5", "w-1/2"];
function ThreadSkeletons() {
  return (
    <div className="flex flex-col" aria-label="Đang tải hội thoại">
      {SKELETON_ROWS.map((w, i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-2">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-3.5", w)} />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
