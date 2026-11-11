import { Fragment, memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ToolbarDialog } from "@/app/chat/components/toolbar/toolbar-editor";
import { MESSAGE_BAR, MESSAGE_TOOLS } from "@/app/chat/constants/toolbar.constants";
import { arrange, useLayout } from "@/shared/hooks/use-toolbar";
import { api, apiBlob } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import type { ChatTarget, ConversationSettings, GroupDetails, MessageRow, MyCloud, Pin, Pins, Thread } from "@/shared/types";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { PollView } from "@/app/chat/components/board/poll-view";
import { ConversationInfo } from "@/app/chat/components/info/conversation-info";
import { RichText } from "@/app/chat/components/message/rich-text";
import { GlassBar } from "@/app/chat/components/conversation/glass-bar";
import { MessageInfoDialog } from "@/app/chat/components/message/message-info-dialog";
import { PinBar } from "@/app/chat/components/header/pin-bar";
import { SearchPanel } from "@/app/chat/components/search/search-panel";
import { MENTION_ALL } from "@/shared/constants/text.constants";
import { lastSeen } from "@/shared/utils/text.utils";
import { TodoEditor } from "@/app/todo/components/todo-editor";
import { GROUP_NOTI, QUOTE } from "@/app/chat/constants/chat.constants";
import { albumAt, attach, ttlText, summary, time } from "@/app/chat/utils/chat.utils";
import { Album, Content } from "@/app/chat/components/message/message-content";
import { SelectionBar } from "@/app/chat/components/conversation/selection-bar";
import { Composer } from "@/app/chat/components/input/composer";
import { ForwardDialog } from "@/app/chat/components/dialogs/forward-dialog";
import { ReplacePinDialog } from "@/app/chat/components/dialogs/replace-pin-dialog";
import { ClockIcon, EllipsisIcon, LockIcon, PanelRightIcon, PhoneIcon, SearchIcon, StarIcon, VideoIcon, XIcon } from "lucide-react";
import { ErrorBanner } from "@/shared/components/error-banner";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/utils/shadcn";

const REACTIONS: Record<string, string> = {
  "/-heart": "❤️",
  "/-strong": "👍",
  ":>": "😆",
  ":o": "😮",
  ":-((": "😢",
  ":-h": "😡",
  "/-weak": "👎",
  "/-rose": "🌹",
  "/-break": "💔",
  ";xx": "😍",
  "/-ok": "👌",
  "/-thanks": "🙏",
  ":-*": "😘",
  ":')": "😂",
};
const PICKER = ["/-heart", "/-strong", ":>", ":o", ":-((", ":-h"];

// Zalo PC "Chia sẻ": what can be forwarded (photo albums and calls can't)
const FORWARDABLE = new Set(["webchat", "chat.photo", "chat.doodle", "chat.voice", "chat.gif", "chat.video.msg", "chat.location.new", "share.file", "chat.sticker"]);
const canForward = (m: MessageRow) => FORWARDABLE.has(m.msgType) || (m.msgType === "chat.recommended" && ["recommened.link", "recommened.user"].includes(attach(m.content).action ?? ""));
// Zalo PC's limit_selected_item for "Chọn nhiều tin nhắn"
const MAX_SELECTED = 100;
// copy of one message: its text, a link's title, else the label
const PHOTOS = new Set(["chat.photo", "chat.doodle"]);

// a photo as a PNG blob, fetched through the server (the webview can't read Zalo's CDN across origins)
async function pngOf(accountId: string, url: string) {
  const bitmap = await createImageBitmap(await apiBlob(`/accounts/${accountId}/image?url=${encodeURIComponent(url)}`));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("Không sao chép được ảnh");
  return png;
}
const copyText = (m: MessageRow) => (m.msgType === "webchat" && typeof m.content === "string" ? m.content : summary(m.msgType, m.content));
const stamp = (ms: number) => new Date(ms).toLocaleString("vi", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
// Zalo PC's copy of several messages: lines of one sender joined, "[time] Name: text" when senders differ
function copyMany(rows: MessageRow[], me: string) {
  const sorted = [...rows].sort((a, b) => a.sendDttm - b.sendDttm);
  const one = new Set(sorted.map((m) => m.fromUid)).size === 1;
  return sorted.map((m) => (one ? copyText(m) : `[${stamp(m.sendDttm)}] ${m.fromUid === me ? "Bạn" : (m.dName ?? "")}: ${copyText(m)}`)).join("\n");
}

// Group events and info messages show as centered lines instead of bubbles, as on PC.
const infoText = (m: MessageRow) =>
  m.msgType === GROUP_NOTI || (m.msgType === "webchat" && attach(m.content).action === "msginfo.actionlist") ? summary(m.msgType, m.content) : null;

export function Conversation({
  accountId,
  online,
  target,
  threads,
  settings,
  info,
  cloud,
  tag,
  todo,
  onInfo,
  onOpen,
  onProfile,
}: {
  accountId: string;
  online: boolean;
  target: ChatTarget;
  threads: Thread[];
  settings: ConversationSettings;
  info: boolean;
  cloud?: MyCloud;
  // "Tất cả": the account this conversation is chatted from
  tag?: ReactNode;
  // Zalo has To-Do on for this account: offers "Giao việc"
  todo: boolean;
  onInfo: (open: boolean) => void;
  onOpen: (t?: ChatTarget) => void;
  onProfile: (userId: string) => void;
}) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  // the first page has arrived: until then the list shows skeleton bubbles
  const [loaded, setLoaded] = useState(false);
  // messages that arrived while the conversation is open (not history): they slide in
  const arrived = useRef(new Set<string>());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [typing, setTyping] = useState<{ userId: string; name: string | null }>();
  const [quote, setQuote] = useState<MessageRow>();
  const [forwarding, setForwarding] = useState<MessageRow>();
  // "Giao việc" from a message
  const [todoOf, setTodoOf] = useState<MessageRow>();
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  // "Chọn nhiều tin nhắn": the picked msgIds while selecting
  const [selected, setSelected] = useState<string[]>();
  const [searching, setSearching] = useState(false);
  const [infoOf, setInfoOf] = useState<MessageRow>();
  // the poll of a group.poll card being looked at
  const [pollOf, setPollOf] = useState<string>();
  const [pins, setPins] = useState<Pins>({ pins: [], limit: 0 });
  // pinning while the list is full: confirm which pin goes ("Cập nhật danh sách ghim")
  const [replacing, setReplacing] = useState<MessageRow>();
  // message to scroll to and highlight (search result, pin, "Tin đánh dấu")
  const [jumpTo, setJumpTo] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const [bars, setBars] = useState({ header: 64, composer: 56 });
  // mention and sticker suggestions float above the composer: inside its bar they'd resize it (and the list's
  // padding) on every key
  const [popups, setPopups] = useState<HTMLDivElement | null>(null);
  const top = useRef<HTMLDivElement>(null);
  // the hover bar's tools as this device arranged them, and "Tùy chỉnh thanh công cụ"
  const layout = useLayout(MESSAGE_BAR);
  const messageTools = useMemo(() => arrange(MESSAGE_TOOLS, layout), [layout]);
  const [customizing, setCustomizing] = useState(false);
  const base = `/accounts/${accountId}/threads/${target.threadId}`;
  // "Cloud của tôi": no recall, no presence; other conversations can save messages into it
  const isCloud = !!cloud?.threadId && cloud.threadId === target.threadId;

  // a refetch (a receipt, a reconnect) brings back rows that didn't change: they keep their object, so their memoized
  // row skips the render, and nothing changed means no update at all
  const merge = (rows: MessageRow[]) =>
    setMessages((current) => {
      const byId = new Map(current.map((m) => [m.msgId, m]));
      let changed = false;
      for (const r of rows) {
        const old = byId.get(r.msgId);
        if (old && JSON.stringify(old) === JSON.stringify(r)) continue;
        byId.set(r.msgId, r);
        changed = true;
      }
      return changed ? [...byId.values()].sort((a, b) => a.sendDttm - b.sendDttm) : current;
    });
  const update = (msgId: string, patch: Partial<MessageRow>) => setMessages((current) => current.map((m) => (m.msgId === msgId ? { ...m, ...patch } : m)));
  const run = (p: Promise<unknown>) => p.catch((e) => setError(e.message));
  // the call engine (ZaloCall, or Nexora's port on Linux) opens its own window
  const call = (video: boolean) =>
    run(api(`/accounts/${accountId}/calls`, "POST", { userId: target.threadId, name, avatar: live?.avatar ?? target.avatar, video }));
  const markSeen = () => online && document.hasFocus() && api(`${base}/seen`, "POST").catch(() => {});
  const loadPins = () =>
    api<Pins>(`${base}/pins`)
      .then(setPins)
      .catch(() => {});
  const notice = (text: string) => (setToast(text), setTimeout(() => setToast(undefined), 2000));
  const copy = (text: string) => run(navigator.clipboard.writeText(text).then(() => notice("Đã sao chép tin nhắn")));
  // PC's "Copy hình ảnh": the photo onto the clipboard. The write starts within the click (WebKit asks for that) and
  // the image follows as PNG, the type clipboards take.
  const copyImage = (url: string) =>
    run(navigator.clipboard.write([new ClipboardItem({ "image/png": pngOf(accountId, url) })]).then(() => notice("Đã sao chép")));

  // loads the message and everything newer when it isn't on screen yet
  const jump = (msgId: string) => {
    setJumpTo(msgId);
    if (!messages.some((m) => m.msgId === msgId))
      api<{ messages: MessageRow[]; hasMore: boolean }>(`${base}/messages?from=${msgId}`)
        .then((r) => (merge(r.messages), setHasMore(r.hasMore)))
        .catch((e) => setError(e.message));
  };
  useEffect(() => {
    if (target.msgId) jump(target.msgId);
  }, [target.msgId]);
  useEffect(() => {
    if (!jumpTo) return;
    const el = document.getElementById(`msg-${jumpTo}`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    const t = setTimeout(() => setJumpTo(undefined), 2500);
    return () => clearTimeout(t);
  }, [jumpTo, messages]);

  // "Tin nhắn tự xóa": messages past their ttl leave the screen, checked every 30s
  const expiring = messages.some((m) => m.ttl);
  useEffect(() => {
    if (!expiring) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [expiring]);
  const shown = messages.filter((m) => !m.ttl || m.sendDttm + m.ttl > now);

  // "Vừa truy cập" / "Truy cập 5 phút trước" under a friend's name: asked once per open, as PC; the text follows
  // re-renders (no timer, as PC). null = nothing to show.
  const [lastOnline, setLastOnline] = useState<number | null>(null);
  useEffect(() => {
    setLastOnline(null);
    if (target.isGroup || !online) return;
    let live = true;
    api<{ lastOnline: number | null }>(`/accounts/${accountId}/users/${target.threadId}/last-online`)
      .then((r) => live && setLastOnline(r.lastOnline))
      .catch(() => {});
    return () => void (live = false);
  }, [target.threadId, online]);

  // senders' avatars beside their messages: a group's from its members, asked once per open
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  useEffect(() => {
    setAvatars({});
    if (!target.isGroup) return;
    let live = true;
    api<GroupDetails>(`/accounts/${accountId}/groups/${target.threadId}`)
      .then((g) => live && setAvatars(Object.fromEntries(g.members.map((m) => [m.userId, m.avatar]))))
      .catch(() => {});
    return () => void (live = false);
  }, [target.threadId]);

  const pin = (m: MessageRow, replace?: Pin) =>
    run(api(`${base}/pins`, "POST", { msgId: m.msgId, replace: replace && { topicId: replace.topicId, topicType: replace.topicType } }).then(() => (setReplacing(undefined), loadPins())));
  const star = (m: MessageRow) => run(api(`${base}/messages/${m.msgId}/star`, "PUT", { starred: !m.starred }).then(() => update(m.msgId, { starred: !m.starred })));
  // an album is selected as a whole
  const toggleSelected = (ids: string[]) => {
    if (!selected) return;
    if (selected.includes(ids[0])) return setSelected(selected.filter((x) => !ids.includes(x)));
    if (selected.length + ids.length > MAX_SELECTED) return notice("Số lượng tin nhắn được chọn vượt quá giới hạn cho phép");
    setSelected([...selected, ...ids]);
  };

  useEffect(() => {
    api<{ messages: MessageRow[]; hasMore: boolean }>(`${base}/messages?limit=30`)
      .then((r) => (merge(r.messages), setHasMore(r.hasMore)))
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
    markSeen();
    loadPins();
    window.addEventListener("focus", markSeen);
    const off = onEvent((e) => {
      if (e.type === "message" && e.message.accountId === accountId && e.message.threadId === target.threadId) {
        arrived.current.add(e.message.msgId);
        merge([e.message]);
        if (e.message.fromUid !== accountId) (setTyping(undefined), markSeen());
      } else if (e.type === "undo" && e.accountId === accountId) update(e.msgId, { msgType: "chat.undo", content: null, quote: null });
      else if (e.type === "reaction" && e.accountId === accountId) update(e.msgId, { reactions: e.reactions });
      else if (e.type === "receipt" && e.accountId === accountId && e.threadId === target.threadId)
        api<{ messages: MessageRow[] }>(`${base}/messages?limit=30`).then((r) => merge(r.messages)).catch(() => {});
      else if (e.type === "typing" && e.accountId === accountId && e.threadId === target.threadId) setTyping({ userId: e.userId, name: e.name });
      else if (e.type === "pins" && e.accountId === accountId && e.threadId === target.threadId) loadPins();
    });
    return () => (off(), window.removeEventListener("focus", markSeen));
  }, []);

  // typing events stop arriving when the other side stops: hide after 5s
  useEffect(() => {
    if (!typing) return;
    const t = setTimeout(() => setTyping(undefined), 5000);
    return () => clearTimeout(t);
  }, [typing]);

  // load older when the top sentinel scrolls into view
  useEffect(() => {
    if (!top.current || !hasMore) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || loadingOlder || !messages.length) return;
      setLoadingOlder(true);
      api<{ messages: MessageRow[]; hasMore: boolean }>(`${base}/messages?limit=30&before=${messages[0].msgId}`)
        .then((r) => (merge(r.messages), setHasMore(r.hasMore)))
        .catch((e) => setError(e.message))
        .finally(() => setLoadingOlder(false));
    });
    observer.observe(top.current);
    return () => observer.disconnect();
  }, [hasMore, loadingOlder, messages]);

  // what the message rows do, behind a ref that keeps its identity: a row re-renders only when its own data changes
  const actions: Actions = {
    profile: onProfile,
    poll: setPollOf,
    call,
    toggle: toggleSelected,
    select: setSelected,
    reply: setQuote,
    forward: setForwarding,
    copy,
    copyImage,
    pin: (m) => (pins.limit && pins.pins.length >= pins.limit ? setReplacing(m) : pin(m)),
    star,
    react: (msgId, icon) => run(api(`${base}/messages/${msgId}/reactions`, "POST", { icon })),
    todo: setTodoOf,
    info: setInfoOf,
    saveToCloud: (m) =>
      run(
        api<{ fail: unknown[] }>(`${base}/messages/${m.msgId}/forward`, "POST", { to: [cloud!.threadId] }).then((r) =>
          notice(r.fail.length ? `Gửi vào ${cloud!.name} thất bại` : `Đã lưu vào ${cloud!.name}`),
        ),
      ),
    undo: (ids) => run(Promise.all(ids.map((id) => api(`${base}/messages/${id}/undo`, "POST")))),
    remove: (ids) => run(Promise.all(ids.map((id) => api(`${base}/messages/${id}`, "DELETE"))).then(() => setMessages((cur) => cur.filter((x) => !ids.includes(x.msgId))))),
    customize: () => setCustomizing(true),
  };
  const act = useRef(actions);
  act.current = actions;

  const lastMine = [...shown].reverse().find((m) => m.fromUid === accountId);
  const receipt = lastMine && lastMine === shown[shown.length - 1] ? (lastMine.seenUids.length ? "Đã xem" : lastMine.deliveredUids.length ? "Đã nhận" : "Đã gửi") : undefined;

  // renames and aliases reach the thread list first
  const live = threads.find((t) => t.threadId === target.threadId);
  const name = live?.name ?? target.name ?? target.threadId;

  // messages scroll under the floating glass header and composer; their heights pad the list.
  // column-reverse keeps the view pinned to the newest message and stable when older ones load above
  return (
    <>
      <section
        className="conversation relative min-w-72 flex-1 overflow-hidden"
        style={{ "--header-h": `${bars.header}px`, "--composer-h": `${bars.composer}px` } as CSSProperties}
      >
        <div className="absolute inset-0 flex flex-col-reverse overflow-y-auto px-4 pt-[calc(var(--header-h)+20px)] pb-[calc(var(--composer-h)+20px)]">
          <div>
            <div ref={top} className="p-2 text-center text-xs text-muted-foreground">
              {!loaded || loadingOlder ? <BubbleSkeletons count={loaded ? 2 : 6} /> : hasMore ? "" : shown.length ? "Hết tin nhắn" : "Chưa có tin nhắn"}
            </div>
            {shown.map((m, i) => {
              const info = infoText(m);
              if (info !== null)
                return (
                  <div key={m.msgId} className="my-2 text-center text-xs text-muted-foreground">
                    <span className="inline-block max-w-[80%] rounded-full bg-white/80 dark:bg-card/90 dark:text-muted-foreground px-3 py-1 shadow-xs border border-transparent dark:border-border/50">{info}</span>
                  </div>
                );
              // photos sent together render once, as the first one's grid
              const album = albumAt(shown, i);
              if (!album.length) return null;
              const prev = shown[i - 1];
              return (
                <MessageItem
                  key={m.msgId}
                  m={m}
                  album={album}
                  me={accountId}
                  first={!prev || prev.fromUid !== m.fromUid || infoText(prev) !== null}
                  avatar={target.isGroup ? avatars[m.fromUid ?? ""] : (live?.avatar ?? target.avatar)}
                  receipt={lastMine && album.includes(lastMine) ? receipt : undefined}
                  checked={selected?.includes(m.msgId)}
                  jumped={jumpTo === m.msgId}
                  fresh={arrived.current.has(m.msgId)}
                  isGroup={target.isGroup}
                  isCloud={isCloud}
                  online={online}
                  todo={todo}
                  cloudName={cloud?.threadId && !isCloud ? cloud.name : undefined}
                  tools={messageTools}
                  act={act}
                />
              );
            })}
            {typing && <div className="px-10 py-1 text-xs text-muted-foreground">{typing.name ?? "Ai đó"} đang soạn tin…</div>}
          </div>
        </div>
        <GlassBar className="top-3" onHeight={(header) => setBars((b) => ({ ...b, header }))}>
          <header className="flex items-center gap-3 px-4 py-2.5">
            <button title={target.isGroup || isCloud ? "Thông tin hội thoại" : "Xem hồ sơ"} onClick={() => (target.isGroup || isCloud ? onInfo(true) : onProfile(target.threadId))}>
              <Avatar src={live?.avatar ?? target.avatar} name={name} size={40} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold flex items-center gap-1.5">
                <span>{name}</span>
                {tag}
                {live?.e2ee && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-normal text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5" title="Đã mã hóa đầu cuối">
                    <LockIcon className="size-3" /> Mã hóa đầu cuối
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {target.isGroup ? "Nhóm" : isCloud ? "Lưu và đồng bộ dữ liệu giữa các thiết bị" : lastOnline ? lastSeen(lastOnline, Date.now()) : ""}
              </div>
            </div>
            {!target.isGroup && !isCloud && (
              <>
                <Button variant="ghost" size="icon" title="Cuộc gọi thoại" onClick={() => call(false)}>
                  <PhoneIcon />
                </Button>
                <Button variant="ghost" size="icon" title="Cuộc gọi video" onClick={() => call(true)}>
                  <VideoIcon />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={cn(searching && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
              title="Tìm kiếm tin nhắn"
              onClick={() => setSearching(!searching)}
            >
              <SearchIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(info && !searching && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
              title={target.isGroup ? "Thông tin nhóm" : "Thông tin hội thoại"}
              onClick={() => (setSearching(false), onInfo(searching || !info))}
            >
              <PanelRightIcon />
            </Button>
          </header>
          <PinBar pins={pins.pins} onJump={jump} onUnpin={(p) => run(api(`${base}/pins`, "DELETE", { topicId: p.topicId, topicType: p.topicType }).then(loadPins))} />
        </GlassBar>
        {error && (
          // solid under the tint: the messages scroll beneath it
          <div className="absolute top-[calc(var(--header-h)+20px)] right-6 left-6 z-3 overflow-hidden rounded-lg bg-background shadow-sm">
            <ErrorBanner text={error} onClose={() => setError(undefined)} />
          </div>
        )}
        {toast && (
          <div className="absolute top-[calc(var(--header-h)+20px)] left-1/2 z-3 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1.5 text-xs text-white">{toast}</div>
        )}
        <div ref={setPopups} className="absolute inset-x-3 bottom-[calc(var(--composer-h)+20px)] z-3 flex flex-col items-start gap-1.5" />
        <GlassBar className="bottom-3" onHeight={(composer) => setBars((b) => ({ ...b, composer }))}>
          {selected ? (
            <SelectionBar
              base={base}
              rows={messages.filter((m) => selected.includes(m.msgId))}
              me={accountId}
              online={online}
              recall={!isCloud}
              onCopy={(rows) => copy(copyMany(rows, accountId))}
              onDeleted={(ids) => (setMessages((cur) => cur.filter((x) => !ids.includes(x.msgId))), setSelected(undefined))}
              onDone={() => setSelected(undefined)}
              onError={setError}
            />
          ) : (
            <>
              {tag && <div className="flex items-center gap-1.5 px-4 pt-2 text-xs text-muted-foreground">Gửi bằng {tag}</div>}
              <Composer
                popups={popups}
                base={base}
                accountId={accountId}
                groupId={target.isGroup ? target.threadId : undefined}
                online={online}
                quote={quote}
                ttl={settings.ttl[target.threadId] ?? 0}
                name={name}
                onQuoteDone={() => setQuote(undefined)}
                onError={setError}
              />
            </>
          )}
        </GlassBar>
        {todoOf && <TodoEditor accountId={accountId} target={target} message={{ msgId: todoOf.msgId, text: copyText(todoOf) }} onClose={() => setTodoOf(undefined)} />}
        {forwarding && <ForwardDialog base={base} message={forwarding} threads={threads.filter((t) => t.threadId !== target.threadId)} onClose={() => setForwarding(undefined)} />}
        {infoOf && <MessageInfoDialog base={base} message={infoOf} onClose={() => setInfoOf(undefined)} />}
        {pollOf && <PollView base={`/accounts/${accountId}/groups/${target.threadId}`} threadId={target.threadId} pollId={pollOf} onClose={() => setPollOf(undefined)} />}
        {replacing && <ReplacePinDialog pins={pins.pins} onConfirm={(old) => pin(replacing, old)} onClose={() => setReplacing(undefined)} />}
        {customizing && <ToolbarDialog onClose={() => setCustomizing(false)} />}
      </section>
      {searching ? (
        <SearchPanel accountId={accountId} target={target} onJump={jump} onClose={() => setSearching(false)} />
      ) : (
        info && (
          <ConversationInfo
            accountId={accountId}
            target={target}
            cloud={isCloud}
            e2ee={live?.e2ee}
            settings={settings}
            onProfile={onProfile}
            onOpen={onOpen}
            onClose={() => onInfo(false)}
            onLeft={() => onOpen(undefined)}
          />
        )
      )}
    </>
  );
}

type Actions = {
  profile: (userId: string) => void;
  poll: (pollId: string) => void;
  call: (video: boolean) => void;
  toggle: (ids: string[]) => void;
  select: (ids: string[]) => void;
  reply: (m: MessageRow) => void;
  forward: (m: MessageRow) => void;
  copy: (text: string) => void;
  copyImage: (url: string) => void;
  pin: (m: MessageRow) => void;
  star: (m: MessageRow) => void;
  react: (msgId: string, icon: string) => void;
  todo: (m: MessageRow) => void;
  info: (m: MessageRow) => void;
  saveToCloud: (m: MessageRow) => void;
  undo: (ids: string[]) => void;
  remove: (ids: string[]) => void;
  customize: () => void;
};

type ItemProps = {
  m: MessageRow;
  // the photos of its album (itself when it isn't one)
  album: MessageRow[];
  me: string;
  // first of a run from one sender: shows the avatar (and the name in a group)
  first: boolean;
  avatar?: string | null;
  // "Đã gửi / Đã nhận / Đã xem" under the last own message
  receipt?: string;
  // undefined: not selecting
  checked?: boolean;
  jumped: boolean;
  // arrived while open: slides in on mount
  fresh: boolean;
  isGroup: boolean;
  isCloud: boolean;
  online: boolean;
  todo: boolean;
  // "Lưu vào Cloud của tôi" when this isn't the cloud itself
  cloudName?: string;
  tools: ReturnType<typeof arrange>;
  act: RefObject<Actions>;
};

// albumAt builds a fresh array each render: compared by its photos
const sameItem = (a: ItemProps, b: ItemProps) =>
  (Object.keys(a) as (keyof ItemProps)[]).every((k) => (k === "album" ? a.album.length === b.album.length && a.album.every((x, i) => x === b.album[i]) : a[k] === b[k]));

const MessageItem = memo(function MessageItem({ m, album, me, first, avatar, receipt, checked, jumped, fresh, isGroup, isCloud, online, todo, cloudName, tools, act }: ItemProps) {
  const ids = album.map((x) => x.msgId);
  // Zalo PC can't forward an album
  const forwardable = canForward(m) && album.length === 1;
  const mine = m.fromUid === me;
  // tagged by name or by @All
  const mentioned = !mine && m.mentions?.some((x) => x.uid === me || x.uid === MENTION_ALL);
  const react = (icon: string) => act.current.react(m.msgId, icon);
  const photo = PHOTOS.has(m.msgType) ? attach(m.content).href : undefined;
  // what each customizable tool does on this message, and whether it applies to it
  const acts: Record<string, { show: boolean; run?: () => void; label?: string }> = {
    react: { show: true },
    reply: { show: m.fromUid !== null, run: () => act.current.reply(m) },
    forward: { show: forwardable, run: () => act.current.forward(m) },
    copy: photo ? { show: true, run: () => act.current.copyImage(photo), label: "Copy hình ảnh" } : { show: true, run: () => act.current.copy(copyText(m)) },
    pin: { show: m.fromUid !== null, run: () => act.current.pin(m) },
    star: { show: true, run: () => act.current.star(m), label: m.starred ? "Bỏ đánh dấu tin nhắn" : "Đánh dấu tin nhắn" },
  };
  const onBar = tools.filter((t) => t.place === "bar" && acts[t.id]?.show);
  const inMenu = tools.filter((t) => t.place === "menu" && acts[t.id]?.show);
  return (
    <div
      id={`msg-${m.msgId}`}
      className={cn("offscreen-skip mt-1 flex gap-2 rounded-lg transition-colors", fresh && "animate-in fade-in-0 slide-in-from-bottom-2 duration-200", mine && "justify-end", jumped && "bg-amber-100 dark:bg-amber-500/20", checked !== undefined && "cursor-pointer")}
      onClick={checked !== undefined && m.msgType !== "chat.undo" ? () => act.current.toggle(ids) : undefined}
    >
      {checked !== undefined && <Checkbox className="mt-3 bg-white dark:bg-card" disabled={m.msgType === "chat.undo"} checked={checked} />}
      {!mine && (
        <div className="w-8 shrink-0">
          {first && (
            <button title={m.dName ?? undefined} onClick={() => m.fromUid && act.current.profile(m.fromUid)}>
              <Avatar src={avatar} name={m.dName ?? "?"} size={32} />
            </button>
          )}
        </div>
      )}
      <div className={cn("flex max-w-[65%] flex-col", mine && "items-end")}>
        {!mine && first && isGroup && <div className="mt-1 mb-0.5 text-xs text-muted-foreground">{m.dName}</div>}
        <div className="group/bubble relative">
          <div
            className={cn(
              // wrap-anywhere: long file names and URLs break instead of pushing the bubble past its 65%
              "rounded-[10px] bg-white px-3 py-2 shadow-xs wrap-anywhere dark:bg-card dark:text-foreground dark:border dark:border-border/60",
              mine && "bg-blue-100 dark:bg-primary/20 dark:border-primary/30 dark:text-foreground",
              mentioned && "ring-2 ring-amber-300 dark:ring-amber-500/50",
              m.msgType === "chat.sticker" && "bg-transparent p-0 shadow-none dark:bg-transparent dark:border-0",
            )}
          >
            {m.quote && (
              <div className={QUOTE}>
                <b>{m.quote.fromD}</b>
                <div>{m.quote.msg ? <RichText text={m.quote.msg} /> : "[Đính kèm]"}</div>
              </div>
            )}
            {album.length > 1 ? (
              <Album photos={album} me={me} />
            ) : (
              <Content
                m={m}
                me={me}
                onProfile={(id) => act.current.profile(id)}
                onPoll={isGroup ? (id) => act.current.poll(id) : undefined}
                onCall={isGroup || isCloud ? undefined : (video) => act.current.call(video)}
              />
            )}
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground [&_svg]:size-3">
              {time(m.sendDttm)}
              {!!m.ttl && (
                <span title={`Tự xóa sau ${ttlText(Math.max(0, m.sendDttm + m.ttl - Date.now()))}`}>
                  <ClockIcon />
                </span>
              )}
              {m.starred && <StarIcon className="fill-amber-400 text-amber-400" />}
            </div>
          </div>
          {/* stays shown while its menu is open: the open menu takes the hover away (pointer-events none on
              the body), and a hidden trigger would send the menu to the top-left corner */}
          {m.msgType !== "chat.undo" && online && checked === undefined && (
            <div
              className={cn(
                "absolute -top-7.5 z-1 hidden items-center gap-0.5 rounded-lg border bg-white p-0.5 whitespace-nowrap shadow-sm group-hover/bubble:flex has-data-[state=open]:flex dark:bg-popover dark:border-border/80",
                mine ? "right-0" : "left-0",
              )}
            >
              {/* the user's layout (MESSAGE_TOOLS): "react" stands for the quick reactions */}
              {onBar.map((t, k) =>
                t.id === "react" ? (
                  <Fragment key="react">
                    {k > 0 && <span className="mx-0.5 h-4 border-l" />}
                    {PICKER.map((icon) => (
                      <Button key={icon} variant="ghost" size="icon-xs" title="Thả cảm xúc" onClick={() => react(icon)}>
                        {REACTIONS[icon]}
                      </Button>
                    ))}
                    {m.reactions.some((r) => r.mine) && (
                      <Button variant="ghost" size="icon-xs" title="Gỡ cảm xúc" onClick={() => react("")}>
                        <XIcon />
                      </Button>
                    )}
                    {k < onBar.length - 1 && <span className="mx-0.5 h-4 border-l" />}
                  </Fragment>
                ) : (
                  <Button key={t.id} variant="ghost" size="icon-xs" title={acts[t.id].label ?? t.label} onClick={acts[t.id].run}>
                    <t.icon />
                  </Button>
                ),
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" title="Thêm">
                    <EllipsisIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-52">
                  {inMenu.map((t) =>
                    t.id === "react" ? (
                      <div key="react" className="flex gap-0.5 p-0.5">
                        {PICKER.map((icon) => (
                          <DropdownMenuItem key={icon} className="justify-center px-1.5" title="Thả cảm xúc" onSelect={() => react(icon)}>
                            {REACTIONS[icon]}
                          </DropdownMenuItem>
                        ))}
                        {m.reactions.some((r) => r.mine) && (
                          <DropdownMenuItem className="px-1.5" title="Gỡ cảm xúc" onSelect={() => react("")}>
                            <XIcon />
                          </DropdownMenuItem>
                        )}
                      </div>
                    ) : (
                      <DropdownMenuItem key={t.id} onSelect={acts[t.id].run}>
                        {acts[t.id].label ?? t.label}
                      </DropdownMenuItem>
                    ),
                  )}
                  <DropdownMenuItem onSelect={() => act.current.select(ids)}>Chọn nhiều tin nhắn</DropdownMenuItem>
                  {todo && m.fromUid !== null && copyText(m).trim() && <DropdownMenuItem onSelect={() => act.current.todo(m)}>Giao việc</DropdownMenuItem>}
                  {mine && isGroup && <DropdownMenuItem onSelect={() => act.current.info(m)}>Xem chi tiết</DropdownMenuItem>}
                  <DropdownMenuSeparator />
                  {cloudName && forwardable && <DropdownMenuItem onSelect={() => act.current.saveToCloud(m)}>Lưu vào {cloudName}</DropdownMenuItem>}
                  {mine && !isCloud && <DropdownMenuItem onSelect={() => act.current.undo(ids)}>Thu hồi</DropdownMenuItem>}
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => act.current.remove(ids)}
                  >
                    {isCloud ? "Xóa" : "Xóa chỉ ở phía tôi"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => act.current.customize()}>Tùy chỉnh thanh công cụ</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        {m.reactions.length > 0 && (
          // positioned so it paints over the (positioned) bubble it overlaps
          <div className="relative -mt-1.5 flex gap-1 text-xs">
            {m.reactions.map((r) => (
              <span key={r.icon} className={cn("rounded-full border bg-white dark:bg-card dark:border-border/80 px-1.5 shadow-2xs", r.mine && "border-primary")}>
                {REACTIONS[r.icon] ?? r.icon} {r.count}
              </span>
            ))}
          </div>
        )}
        {receipt && <div className="mt-0.5 text-[11px] text-muted-foreground">{receipt}</div>}
      </div>
    </div>
  );
}, sameItem);

// the shape of a conversation while it loads: bubbles of varied width, alternating sides
const SKELETON_BUBBLES: { mine: boolean; w: string; h: string }[] = [
  { mine: false, w: "w-56", h: "h-10" },
  { mine: false, w: "w-40", h: "h-10" },
  { mine: true, w: "w-64", h: "h-14" },
  { mine: false, w: "w-48", h: "h-24" },
  { mine: true, w: "w-36", h: "h-10" },
  { mine: true, w: "w-52", h: "h-10" },
];
function BubbleSkeletons({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-2 py-1" aria-label="Đang tải tin nhắn">
      {SKELETON_BUBBLES.slice(0, count).map((b, i) => (
        <div key={i} className={cn("flex items-end gap-2", b.mine && "justify-end")}>
          {!b.mine && <Skeleton className="size-8 shrink-0 rounded-full" />}
          <Skeleton className={cn("rounded-[10px]", b.w, b.h, b.mine && "bg-blue-100/70 dark:bg-primary/15")} />
        </div>
      ))}
    </div>
  );
}
