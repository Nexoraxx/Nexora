import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, apiBlob } from "@/core/http/api";
import { clipboardFiles, openExternal } from "@/core/tauri/native";
import type { Gif, GroupDetails, LinkPreview, MessageRow, Sticker } from "@/shared/types";
import { CardPicker } from "@/app/chat/components/input/card-picker";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { PollCreate } from "@/app/chat/components/board/poll-create";
import { NoteEditor } from "@/app/chat/components/board/note-editor";
import { ReminderEditor } from "@/app/chat/components/board/reminder-editor";
import { EmojiPicker } from "@/app/chat/components/input/emoji-picker";
import { RichText } from "@/app/chat/components/message/rich-text";
import { FormatBar } from "@/app/chat/components/input/format-bar";
import { Formatted } from "@/app/chat/components/message/formatted";
import { StickerPicker } from "@/app/chat/components/input/sticker-picker";
import { StickerSuggestions } from "@/app/chat/components/input/sticker-suggestions";
import { MENTION_ALL } from "@/shared/constants/text.constants";
import { editMarks, findMentions, fold, matchQuick, slashQuery, stylesFrom, toggleMark } from "@/shared/utils/text.utils";
import type { Marks } from "@/shared/models/text.model";
import { QuickSuggestions } from "@/app/chat/components/input/quick-suggestions";
import { useQuickMessages } from "@/app/settings/hooks/useQuickMessages";
import { summary } from "@/app/chat/utils/chat.utils";
import { PendingFiles } from "@/app/chat/components/input/pending-files";
import { ToolbarDialog } from "@/app/chat/components/toolbar/toolbar-editor";
import { COMPOSER_BAR, COMPOSER_TOOLS, GROUP_ONLY } from "@/app/chat/constants/toolbar.constants";
import { arrange, useLayout } from "@/shared/hooks/use-toolbar";
import { LinkIcon, PlusIcon, Settings2Icon, UsersIcon, XIcon } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils/shadcn";
import { Img } from "@/shared/components/img";

// files behind pasted paths, read by the server (same machine)
const localFiles = (accountId: string, paths: string[]) =>
  Promise.all(
    paths.map(async (path) => {
      const blob = await apiBlob(`/accounts/${accountId}/local-file?path=${encodeURIComponent(path)}`);
      return new File([blob], path.split("/").pop()!, { type: blob.type });
    }),
  );

// Zalo PC's composer link preview: the only URL of the text; a typed one counts once something follows it, a pasted
// one right away; over 500 characters or with several URLs there's no preview.
// ponytail: http(s):// and www. links only; PC's findFirstUrl also catches bare domains like zalo.me
const URL_RE = /(?:https?:\/\/|www\.)[^\s]+/gi;
function previewUrl(text: string, allowAtEnd: boolean) {
  const found = [...text.matchAll(URL_RE)];
  if (found.length !== 1) return undefined;
  const [url] = found[0];
  if (url.length > 500 || (!allowAtEnd && found[0].index + url.length === text.length)) return undefined;
  return url;
}

export function Composer({
  popups,
  base,
  accountId,
  groupId,
  online,
  quote,
  ttl,
  name,
  onQuoteDone,
  onError,
}: {
  popups: HTMLElement | null;
  base: string;
  accountId: string;
  groupId?: string;
  online: boolean;
  quote?: MessageRow;
  // "Tin nhắn tự xóa" of the thread, for the placeholder
  ttl: number;
  name: string;
  onQuoteDone: () => void;
  onError: (e: string) => void;
}) {
  const [text, setText] = useState("");
  // Zalo PC's preview: pasted images and files wait above the box until sent
  const [pending, setPending] = useState<File[]>([]);
  // "Định dạng tin nhắn": codes per character of text, and whether the toolbar is open (Ctrl + Shift + X)
  const [marks, setMarks] = useState<Marks>([]);
  const [formatting, setFormatting] = useState(false);
  const [caret, setCaret] = useState(0);
  const [panel, setPanel] = useState<"emoji" | "sticker">();
  const [sending, setSending] = useState(false);
  const [cards, setCards] = useState(false);
  // "Tạo bình chọn" / "Tạo ghi chú" (groups), "Tạo nhắc hẹn"
  const [creating, setCreating] = useState<"poll" | "note" | "reminder">();
  const layout = useLayout(COMPOSER_BAR);
  const [customizing, setCustomizing] = useState(false);
  // link preview of the URL in the text; null = Zalo has none; `closed` = the URL whose preview was dismissed
  const [preview, setPreview] = useState<{ url: string; data?: LinkPreview | null }>();
  const [closed, setClosed] = useState<string>();
  const pasted = useRef(false);
  const previews = useRef(new Map<string, LinkPreview | null>());
  // members to tag (a locked group lists only owner, deputies and self) and the "@Name"s picked so far
  const [group, setGroup] = useState<GroupDetails>();
  const [picked, setPicked] = useState<{ uid: string; name: string }[]>([]);
  const files = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);

  // the "@word" being typed right before the caret, groups only
  const at = groupId ? /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))?.[1] : undefined;
  useEffect(() => {
    if (at !== undefined && !group)
      api<GroupDetails>(`/accounts/${accountId}/groups/${groupId}`)
        .then(setGroup)
        .catch((e) => onError(e.message));
  }, [at !== undefined]);
  const suggestions =
    at === undefined
      ? []
      : [{ uid: MENTION_ALL, name: "All", avatar: "" }, ...(group?.members ?? []).filter((m) => m.userId !== accountId).map((m) => ({ uid: m.userId, name: m.name, avatar: m.avatar }))]
          .filter((s) => fold(s.name).includes(fold(at)))
          .slice(0, 8);

  // "Tin nhắn nhanh": the "/word" right before the caret; Esc hides the box until the text changes
  const slash = slashQuery(text, caret);
  const quickItems = useQuickMessages(accountId, slash !== undefined);
  const [quickPick, setQuickPick] = useState(0);
  const [quickHidden, setQuickHidden] = useState<string>();
  const quick = slash !== undefined && quickItems && quickHidden !== text ? matchQuick(quickItems, slash) : undefined;
  useEffect(() => setQuickPick(0), [slash]);

  const url = previewUrl(text, pasted.current || preview?.url !== undefined);
  useEffect(() => {
    if (!url || url === closed) return setPreview(undefined);
    if (previews.current.has(url)) return setPreview({ url, data: previews.current.get(url) });
    setPreview({ url });
    api<LinkPreview | null>(`/accounts/${accountId}/link-preview?url=${encodeURIComponent(url)}`)
      .then((data) => (previews.current.set(url, data), setPreview((p) => (p?.url === url ? { url, data } : p))))
      .catch(() => setPreview((p) => (p?.url === url ? { url, data: null } : p)));
  }, [url, closed]);
  // a ready preview (not while quoting) turns the message into one link message carrying the whole text
  const link = !quote && preview?.url === url ? preview?.data : undefined;

  // true when it went through
  const send = async (p: Promise<unknown>) => {
    setSending(true);
    try {
      await p;
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    } finally {
      setSending(false);
    }
  };

  const changeText = (next: string) => (setMarks(editMarks(marks, text, next)), setText(next));
  const clearText = () => (setText(""), setMarks([]));

  // ponytail: the textarea can't show styles, so formatted text shows in a preview above it; a rich editor if that's not enough
  const format = (code: string) => {
    const el = input.current;
    const [from, to] = [el?.selectionStart ?? 0, el?.selectionEnd ?? 0];
    setMarks(code === "clear" ? marks.map((m, i) => (from === to || (i >= from && i < to) ? "" : m)) : toggleMark(editMarks(marks, text, text), text, from, to, code));
    requestAnimationFrame(() => (el?.focus(), el?.setSelectionRange(from, to)));
  };

  const sendText = () => {
    const value = text.trim();
    if (!value || sending) return;
    const mentions = findMentions(value, picked);
    const lead = text.length - text.trimStart().length;
    const styles = stylesFrom(editMarks(marks, text, text).slice(lead, lead + value.length));
    const done = () => (clearText(), setPicked([]), onQuoteDone(), (pasted.current = false), setClosed(undefined));
    // formatted text goes as a text message (PC's rtf); a ready link preview otherwise makes it a link message
    if (link && !styles.length) send(api(`${base}/links`, "POST", { text: value, preview: link, mentions: mentions.length ? mentions : undefined }).then(done));
    else
      send(
        api(`${base}/messages`, "POST", { text: value, quoteMsgId: quote?.msgId, mentions: mentions.length ? mentions : undefined, styles: styles.length ? styles : undefined }).then(done),
      );
  };

  // `then` runs only when sending succeeded
  const sendSticker = (s: Sticker, then: () => void) => send(api(`${base}/stickers`, "POST", { id: s.id, cateId: s.cateId, type: s.type }).then(then));

  // `replace` characters before the caret are replaced too (the typed "@word" of a mention)
  const insertAtCaret = (value: string, replace = 0) => {
    const el = input.current;
    const start = (el?.selectionStart ?? text.length) - replace;
    const end = el?.selectionEnd ?? text.length;
    changeText(text.slice(0, start) + value + text.slice(end));
    setCaret(start + value.length);
    requestAnimationFrame(() => (el?.focus(), el?.setSelectionRange(start + value.length, start + value.length)));
  };

  const sendFiles = async (list: File[]) => {
    if (!list.length) return true;
    const form = new FormData();
    // images need their size; other files send null
    const dims = await Promise.all(
      [...list].map(async (f) => {
        form.append("files", f);
        if (!f.type.startsWith("image/")) return null;
        const bmp = await createImageBitmap(f).catch(() => null);
        return bmp && { width: bmp.width, height: bmp.height };
      }),
    );
    form.append("dims", JSON.stringify(dims));
    const sent = await send(api(`${base}/attachments`, "POST", form));
    if (files.current) files.current.value = "";
    return sent;
  };

  // Enter / Gửi: the pasted files waiting above the box first (kept if they fail), then the text
  const submit = async () => {
    if (sending) return;
    if (pending.length && !(await sendFiles(pending))) return;
    setPending([]);
    sendText();
  };

  // PC replaces the "/word" with the text and sends nothing; an item's photo isn't attached
  // ponytail: photo items insert their text only (PC adds the photo to the attachments to send)
  const pickQuick = (q: { title: string }) => q.title && insertAtCaret(q.title, slash!.length + 1);

  const pickMention = (s: { uid: string; name: string }) => {
    insertAtCaret(`@${s.name} `, at!.length + 1);
    setPicked((p) => [...p, { uid: s.uid, name: s.name }]);
  };

  // borderless tools over the glass: only the pressed one is tinted
  const toggle = (on: boolean) => cn("border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-white/60 hover:text-foreground", on && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary");
  // what each tool does and whether its panel is open, wherever the user put it
  const tools: Record<string, { run: () => void; on?: boolean; title?: string }> = {
    file: { run: () => files.current?.click() },
    emoji: { run: () => setPanel((p) => (p === "emoji" ? undefined : "emoji")), on: panel === "emoji" },
    sticker: { run: () => setPanel((p) => (p === "sticker" ? undefined : "sticker")), on: panel === "sticker" },
    card: { run: () => setCards(true), on: cards },
    format: { run: () => setFormatting(!formatting), on: formatting, title: "Định dạng tin nhắn (Ctrl + Shift + X)" },
    poll: { run: () => setCreating("poll"), on: creating === "poll" },
    note: { run: () => setCreating("note"), on: creating === "note" },
    reminder: { run: () => setCreating("reminder"), on: creating === "reminder" },
  };
  const arranged = arrange(COMPOSER_TOOLS, layout).filter((t) => groupId || !GROUP_ONLY.has(t.id));
  const barTools = arranged.filter((t) => t.place === "bar");
  const menuTools = arranged.filter((t) => t.place === "menu");

  if (!online) return <div className="p-4 text-center text-xs text-muted-foreground">Tài khoản chưa kết nối, không gửi được tin nhắn</div>;
  return (
    <div className="px-3 py-2">
      {quote && (
        <div className="mb-1.5 flex items-center gap-2 border-l-3 border-primary bg-slate-50 dark:bg-card/90 px-2 py-1 text-[13px] rounded-r-md">
          <div className="min-w-0 flex-1">
            Trả lời <b>{quote.dName}</b>: <RichText text={summary(quote.msgType, quote.content)} />
          </div>
          <Button variant="ghost" size="icon-xs" onClick={onQuoteDone}>
            <XIcon />
          </Button>
        </div>
      )}
      {panel === "emoji" && <EmojiPicker accountId={accountId} onPick={insertAtCaret} />}
      {panel === "sticker" && (
        <StickerPicker
          accountId={accountId}
          onPick={(s) => sendSticker(s, () => setPanel(undefined))}
          onGif={(g: Gif) => send(api(`${base}/gifs`, "POST", g).then(() => setPanel(undefined)))}
        />
      )}
      {customizing && <ToolbarDialog onClose={() => setCustomizing(false)} />}
      {cards && <CardPicker accountId={accountId} onSend={(userIds, withPhone) => api(`${base}/cards`, "POST", { userIds, withPhone })} onClose={() => setCards(false)} />}
      {creating === "poll" && groupId && <PollCreate base={`/accounts/${accountId}/groups/${groupId}`} onClose={() => setCreating(undefined)} />}
      {creating === "note" && groupId && <NoteEditor base={`/accounts/${accountId}/groups/${groupId}`} onClose={() => setCreating(undefined)} />}
      {creating === "reminder" && <ReminderEditor base={base} isGroup={!!groupId} onClose={() => setCreating(undefined)} />}
      {preview && !quote && (
        <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-white/80 dark:bg-card/90 dark:border dark:border-border/60 p-1.5 shadow-xs">
          {preview.data === undefined ? (
            <span className="px-1 text-xs text-muted-foreground">Đang tải xem trước…</span>
          ) : preview.data ? (
            <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => openExternal(preview.data!.href)}>
              {preview.data.thumb && <Img className="size-16 shrink-0 rounded object-cover" src={preview.data.thumb} icon={LinkIcon} />}
              <div className="min-w-0">
                <div className="truncate font-semibold">{preview.data.title || preview.data.href}</div>
                {preview.data.desc && <div className="line-clamp-2 text-xs text-muted-foreground">{preview.data.desc}</div>}
                <div className="truncate text-xs text-muted-foreground">{preview.data.src}</div>
              </div>
            </button>
          ) : null}
          {preview.data !== null && (
            <Button variant="ghost" size="icon-xs" className="ml-auto" title="Đóng" onClick={() => setClosed(preview.url)}>
              <XIcon />
            </Button>
          )}
        </div>
      )}
      {pending.length > 0 && <PendingFiles files={pending} onRemove={(f) => setPending((p) => p.filter((x) => x !== f))} />}
      {formatting && <FormatBar onApply={format} />}
      {formatting && marks.some(Boolean) && (
        <div className="mb-1.5 max-h-40 overflow-y-auto rounded-lg bg-white/80 px-2 py-1">
          <div className="text-[11px] text-muted-foreground">Xem trước</div>
          <Formatted text={text} styles={stylesFrom(editMarks(marks, text, text))} />
        </div>
      )}
      {/* Zalo PC clears the box after sending a suggested sticker */}
      {popups &&
        createPortal(
          <>
            <StickerSuggestions accountId={accountId} text={text} caret={caret} onPick={(s) => sendSticker(s, clearText)} />
            {quick && <QuickSuggestions items={quick} selected={quickPick} onPick={pickQuick} />}
            {suggestions.length > 0 && (
              <div className="max-h-60 w-80 max-w-full overflow-y-auto rounded-lg border bg-white dark:bg-popover dark:border-border/80 py-1 shadow-md">
                {group?.locked && <p className="px-3 py-1 text-xs text-muted-foreground">Bạn chỉ có thể báo cho cả nhóm hoặc trưởng/phó nhóm.</p>}
                {suggestions.map((s) => (
                  <button key={s.uid} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-muted" onClick={() => pickMention(s)}>
                    {s.uid === MENTION_ALL ? (
                      <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <UsersIcon className="size-4" />
                      </span>
                    ) : (
                      <Avatar src={s.avatar} name={s.name} size={28} />
                    )}
                    <span className="truncate">{s.uid === MENTION_ALL ? "Báo cho cả nhóm" : s.name}</span>
                    {s.uid === MENTION_ALL && <span className="text-xs text-muted-foreground">@All</span>}
                  </button>
                ))}
              </div>
            )}
          </>,
          popups,
        )}
      {/* too narrow for one row: the tools wrap above the input, as Zalo PC lays them out */}
      <div className="flex flex-wrap items-end gap-1.5">
        {/* the user's layout: tools on the bar, the rest grouped under "Thêm", hidden ones nowhere */}
        {barTools.map((t) => (
          <Button key={t.id} variant="outline" size="icon" className={toggle(!!tools[t.id].on)} title={tools[t.id].title ?? t.label} onClick={tools[t.id].run}>
            <t.icon />
          </Button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className={toggle(menuTools.some((t) => tools[t.id].on))} title="Thêm">
              <PlusIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {menuTools.map((t) => (
              <DropdownMenuItem key={t.id} onSelect={tools[t.id].run}>
                <t.icon /> {t.label}
              </DropdownMenuItem>
            ))}
            {menuTools.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => setCustomizing(true)}>
              <Settings2Icon /> Tùy chỉnh thanh công cụ
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Textarea
          ref={input}
          rows={1}
          className="max-h-30 min-h-8 min-w-40 flex-1 resize-none border-0 bg-white/60 dark:bg-card/70 dark:text-foreground dark:focus-visible:bg-card/90 py-1.5 [scrollbar-width:thin] focus-visible:bg-white/90 focus-visible:ring-0"
          placeholder={ttl ? `Nhập tin nhắn tự xóa gửi đến ${name}` : "Nhập tin nhắn…"}
          value={text}
          onPaste={(e) => {
            // Zalo PC puts pasted images (and copied files) in its preview, sent with the next Enter / Gửi
            const add = (list: File[]) => setPending((p) => [...p, ...list]);
            const pastedFiles = [...e.clipboardData.files];
            if (pastedFiles.length) return e.preventDefault(), add(pastedFiles);
            // files copied in the file manager: WebKitGTK shows only a bare "text/uri-list" (no text), the paths come
            // from the app's native clipboard; a browser hands the file:// list over itself
            const data = e.clipboardData;
            if (data.types.includes("text/uri-list") && !data.getData("text/plain")) {
              e.preventDefault();
              const listed = data
                .getData("text/uri-list")
                .split(/\r?\n/)
                .filter((l) => l.startsWith("file://"))
                .map((uri) => decodeURIComponent(new URL(uri).pathname));
              return void (listed.length ? Promise.resolve(listed) : clipboardFiles())
                .then((paths) => localFiles(accountId, paths))
                .then(add, (err: Error) => onError(err.message));
            }
            pasted.current = true;
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onChange={(e) => {
            changeText(e.target.value);
            setCaret(e.target.selectionStart);
            if (!e.target.value) pasted.current = false;
            // Zalo shows typing for a few seconds per event
            if (Date.now() - lastTyping.current > 3000) {
              lastTyping.current = Date.now();
              api(`${base}/typing`, "POST").catch(() => {});
            }
          }}
          onKeyDown={(e) => {
            const key = e.key.toLowerCase();
            if (e.ctrlKey && e.shiftKey && key === "x") return e.preventDefault(), setFormatting(!formatting);
            if (formatting && e.ctrlKey && !e.shiftKey && (key === "b" || key === "i" || key === "u")) return e.preventDefault(), format(key);
            if (quick && (e.key === "ArrowDown" || e.key === "ArrowUp") && quick.length)
              return e.preventDefault(), setQuickPick((i) => (i + (e.key === "ArrowDown" ? 1 : quick.length - 1)) % quick.length);
            if (quick && e.key === "Escape") return e.preventDefault(), setQuickHidden(text);
            if (quick?.length && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) return e.preventDefault(), pickQuick(quick[quickPick] ?? quick[0]);
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (suggestions.length) pickMention(suggestions[0]);
              else submit();
            }
          }}
        />
        <Button disabled={(!text.trim() && !pending.length) || sending} onClick={submit}>
          Gửi
        </Button>
      </div>
      <input ref={files} type="file" multiple hidden onChange={(e) => sendFiles([...(e.target.files ?? [])])} />
    </div>
  );
}
