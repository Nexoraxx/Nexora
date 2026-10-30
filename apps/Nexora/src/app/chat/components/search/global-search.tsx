import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import type { ChatTarget, FoundUser } from "@/shared/types";
import { summary } from "@/app/chat/utils/chat.utils";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { PinDialog } from "@/app/chat/components/dialogs/pin-dialog";
import { markWords } from "@/shared/utils/text.utils";
import type { SearchContact, SearchMessage } from "@/app/chat/models/search.model";
import { Row } from "@/app/chat/components/search/search-row";
import { cn } from "@/shared/utils/shadcn";

// hidden: "Trò chuyện ẩn" matches (all of them when the keyword is the PIN: unlocked, no PIN asked)
type Results = { contacts: SearchContact[]; hidden: SearchContact[]; unlocked: boolean; messages: SearchMessage[]; files: SearchMessage[] };
type Recent = { contacts: SearchContact[]; keywords: string[] };
type Tab = "all" | "contacts" | "messages" | "files";

// Zalo PC num_quick_view_global_search: what the "Tất cả" tab shows per section
const QUICK = { contacts: 6, messages: 3, files: 3 };
// PC's "Tìm bạn qua số điện thoại": digits, spaces, ( ) + . - up to 25 characters
const PHONE = /^[0-9)( +.-]{1,25}$/;
const count = (n: number) => (n > 99 ? "99+" : String(n));
const day = (ms: number) => new Date(ms).toLocaleDateString("vi", { day: "2-digit", month: "2-digit" });

// Zalo PC's search under the conversation list's search box: "Tìm gần đây" while empty, then contacts, messages and
// files in "Tất cả" / "Danh bạ" / "Tin nhắn" / "File" tabs.
export function GlobalSearch({
  accountId,
  q,
  onOpen,
  onClose,
}: {
  accountId: string;
  q: string;
  onOpen: (t: ChatTarget) => void;
  onClose: () => void;
}) {
  const [results, setResults] = useState<Results>();
  const [recent, setRecent] = useState<Recent>();
  const [phone, setPhone] = useState<FoundUser | null>();
  const [tab, setTab] = useState<Tab>("all");
  // a hidden conversation waiting for its PIN ("Nhập mã PIN để mở trò chuyện")
  const [locked, setLocked] = useState<SearchContact>();
  const [error, setError] = useState<string>();
  const base = `/accounts/${accountId}`;
  const keyword = q.trim();

  const loadRecent = () =>
    api<Recent>(`${base}/recent-search`)
      .then(setRecent)
      .catch(() => setRecent({ contacts: [], keywords: [] }));
  useEffect(() => void loadRecent(), [accountId]);

  // contacts right away (PC throttles from 70ms), messages and files after typing stops
  useEffect(() => {
    setError(undefined);
    setPhone(undefined);
    if (!keyword) return setResults(undefined);
    const t = setTimeout(
      () =>
        api<Results>(`${base}/search?q=${encodeURIComponent(keyword)}`)
          .then(setResults)
          .catch((e) => setError(e.message)),
      150,
    );
    const p = PHONE.test(keyword) && /\d{6,}/.test(keyword.replace(/\D/g, "")) ? setTimeout(() => api<FoundUser | null>(`${base}/users/find?phone=${encodeURIComponent(keyword)}`).then(setPhone).catch(() => setPhone(null)), 500) : undefined;
    return () => (clearTimeout(t), clearTimeout(p));
  }, [keyword]);

  const remember = (body: { kind: "contact"; id: string; isGroup: boolean } | { kind: "keyword"; key: string }) => api(`${base}/recent-search`, "POST", body).catch(() => {});
  const openContact = (c: SearchContact, isHidden = false) => {
    // hidden conversations never go into "Tìm gần đây"
    if (!isHidden) remember({ kind: "contact", id: c.userId, isGroup: c.isGroup });
    onOpen({ threadId: c.userId, isGroup: c.isGroup, name: c.name, avatar: c.avatar });
    onClose();
  };
  const openMessage = (m: SearchMessage) => {
    remember({ kind: "keyword", key: keyword });
    onOpen({ threadId: m.threadId, isGroup: m.isGroup, name: m.threadName, avatar: m.threadAvatar, msgId: m.msgId });
    onClose();
  };
  const forget = (body: { kind: "contact"; id: string; isGroup: boolean } | { kind: "keyword"; key: string }) =>
    api(`${base}/recent-search`, "DELETE", body)
      .then(loadRecent)
      .catch((e) => setError(e.message));

  if (!keyword)
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2 text-xs font-semibold">Tìm gần đây</div>
        {recent && !recent.contacts.length && !recent.keywords.length && <p className="px-3 text-xs text-muted-foreground">Không có tìm kiếm nào gần đây</p>}
        {recent?.keywords.map((k) => (
          <Row key={`k-${k}`} onRemove={() => forget({ kind: "keyword", key: k })}>
            <span className="truncate text-[13px]">🔍 {k}</span>
          </Row>
        ))}
        {!!recent?.keywords.length && !!recent.contacts.length && <div className="mx-3 my-1 border-t" />}
        {recent?.contacts.map((c) => (
          <Row key={c.userId} onClick={() => openContact(c)} onRemove={() => forget({ kind: "contact", id: c.userId, isGroup: c.isGroup })}>
            <Avatar src={c.avatar} name={c.name} size={36} />
            <span className="truncate">{c.name}</span>
          </Row>
        ))}
      </div>
    );

  const mark = (text: string) => markWords(text, keyword).map((p, i) => (p.hit ? <b key={i}>{p.text}</b> : p.text));
  const contact = (c: SearchContact) => (
    <Row key={c.userId} onClick={() => openContact(c)}>
      <Avatar src={c.avatar} name={c.name} size={40} />
      <div className="min-w-0">
        <div className="truncate">{mark(c.name)}</div>
        {c.isGroup && <div className="text-xs text-muted-foreground">Nhóm</div>}
      </div>
    </Row>
  );
  const message = (m: SearchMessage) => (
    <Row key={m.msgId} onClick={() => openMessage(m)}>
      <Avatar src={m.threadAvatar} name={m.threadName ?? "?"} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2">
          <span className="truncate font-medium">{m.threadName ?? m.threadId}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{day(m.sendDttm)}</span>
        </div>
        <div className="truncate text-[13px] text-muted-foreground">
          {m.fromUid === accountId ? "Bạn: " : m.isGroup && m.dName ? `${m.dName}: ` : ""}
          {mark(summary(m.msgType, m.content))}
        </div>
      </div>
    </Row>
  );
  const section = (title: string, list: SearchMessage[] | SearchContact[], key: Exclude<Tab, "all">, more: string, render: (x: never) => React.ReactNode) =>
    list.length > 0 && (
      <section className="pb-1">
        <div className="px-3 py-2 text-xs font-semibold">
          {title} ({count(list.length)})
        </div>
        {(tab === "all" ? list.slice(0, QUICK[key]) : list).map((x) => render(x as never))}
        {tab === "all" && list.length > QUICK[key] && (
          <button className="w-full px-3 py-1.5 text-center text-xs text-primary hover:bg-muted" onClick={() => setTab(key)}>
            {more}
          </button>
        )}
      </section>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1 border-b px-2 pb-1.5 text-xs">
        {(
          [
            ["all", "Tất cả"],
            ["contacts", "Danh bạ"],
            ["messages", "Tin nhắn"],
            ["files", "File"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button key={key} className={cn("rounded-full px-2.5 py-1", tab === key ? "bg-primary/15 font-semibold text-primary" : "hover:bg-muted")} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {error && <p className="p-3 text-xs text-red-600">{error}</p>}
        {phone && (tab === "all" || tab === "contacts") && (
          <section>
            <div className="px-3 py-2 text-xs font-semibold">Tìm bạn qua số điện thoại:</div>
            {contact({ userId: phone.userId, isGroup: false, name: phone.displayName, avatar: phone.avatar, isFr: !!phone.isFr })}
          </section>
        )}
        {results && results.hidden.length > 0 && (tab === "all" || tab === "contacts") && (
          <section>
            <div className="px-3 py-2 text-xs font-semibold">Trò chuyện ẩn</div>
            {results.hidden.map((c) => (
              <Row key={c.userId} onClick={() => (results.unlocked ? openContact(c, true) : setLocked(c))}>
                <Avatar src={c.avatar} name={c.name} size={40} />
                <span className="truncate">{mark(c.name)}</span>
              </Row>
            ))}
          </section>
        )}
        {locked && (
          <PinDialog
            title="Mở trò chuyện"
            description="Nhập mã PIN để mở trò chuyện"
            note="Quên mã PIN? Bạn phải cài đặt lại mã."
            onSubmit={(pin) => api(`${base}/hidden-chats/verify`, "POST", { pin }).then(() => openContact(locked, true))}
            onClose={() => setLocked(undefined)}
          />
        )}
        {results && (
          <>
            {(tab === "all" || tab === "contacts") && section("Liên hệ", results.contacts, "contacts", "Xem tất cả liên hệ", contact)}
            {(tab === "all" || tab === "messages") && section("Tin nhắn", results.messages, "messages", "Xem tất cả tin nhắn", message)}
            {(tab === "all" || tab === "files") && section("File", results.files, "files", "Xem tất cả files", message)}
            {!results.contacts.length && !results.hidden.length && !results.messages.length && !results.files.length && !phone && (
              <p className="p-4 text-center text-xs text-muted-foreground">Không tìm thấy kết quả</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
