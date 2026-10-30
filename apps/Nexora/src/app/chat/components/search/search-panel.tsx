import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import type { ChatTarget, GroupDetails, MessageRow } from "@/shared/types";
import { summary } from "@/app/chat/utils/chat.utils";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { markWords } from "@/shared/utils/text.utils";
import { XIcon } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";

// Zalo PC search_message.in_chat: keywords up to 100 characters, 200ms debounce
const MAX_KEYWORD = 100;
const PAGE = 20;
const DAY = 86_400_000;
// "Gợi ý thời gian": from 00:00 N days ago to the end of today
const PRESETS: [string, number][] = [
  ["7 ngày trước", 7],
  ["30 ngày trước", 30],
  ["3 tháng trước", 90],
];
type Range = { since: number; until: number; label: string };

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
const day = (ms: number) => new Date(ms).toLocaleDateString("vi", { day: "2-digit", month: "2-digit", year: "numeric" });

// Zalo PC's "Tìm kiếm trong trò chuyện" panel: keyword, "Người gửi" and "Ngày gửi" filters, newest first; a result
// jumps to its message.
export function SearchPanel({
  accountId,
  target,
  onJump,
  onClose,
}: {
  accountId: string;
  target: ChatTarget;
  onJump: (msgId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sender, setSender] = useState<{ uid: string; name: string }>();
  const [range, setRange] = useState<Range>();
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [people, setPeople] = useState<{ uid: string; name: string; avatar: string | null }[]>([]);
  const [results, setResults] = useState<MessageRow[]>();
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string>();
  const base = `/accounts/${accountId}`;

  // group: its members; 1-1: the two of us
  useEffect(() => {
    if (target.isGroup)
      api<GroupDetails>(`${base}/groups/${target.threadId}`)
        .then((g) => setPeople(g.members.map((m) => ({ uid: m.userId, name: m.userId === accountId ? "Bạn" : m.name, avatar: m.avatar }))))
        .catch(() => {});
    else
      setPeople([
        { uid: accountId, name: "Bạn", avatar: null },
        { uid: target.threadId, name: target.name ?? target.threadId, avatar: target.avatar },
      ]);
  }, [target.threadId]);

  const query = (offset: number) => {
    const p = new URLSearchParams({ q: q.trim(), limit: String(PAGE), offset: String(offset) });
    if (sender) p.set("fromUid", sender.uid);
    if (range) (p.set("since", String(range.since)), p.set("until", String(range.until)));
    return api<MessageRow[]>(`${base}/threads/${target.threadId}/search?${p}`);
  };

  useEffect(() => {
    setError(undefined);
    if (!q.trim()) return setResults(undefined);
    if (q.length > MAX_KEYWORD) return setError(`Vui lòng nhập ít hơn ${MAX_KEYWORD} ký tự`);
    const t = setTimeout(
      () =>
        query(0)
          .then((r) => (setResults(r), setMore(r.length === PAGE)))
          .catch((e) => setError(e.message)),
      200,
    );
    return () => clearTimeout(t);
  }, [q, sender, range]);

  const loadMore = () =>
    query(results!.length)
      .then((r) => (setResults((cur) => [...(cur ?? []), ...r]), setMore(r.length === PAGE)))
      .catch((e) => setError(e.message));

  const preset = (label: string, days: number) => setRange({ since: startOfDay(Date.now() - days * DAY) - 1, until: startOfDay(Date.now()) + DAY, label });
  const applyCustom = () => {
    const from = custom.from ? startOfDay(new Date(custom.from).getTime()) : 0;
    const to = custom.to ? startOfDay(new Date(custom.to).getTime()) + DAY : Date.now() + DAY;
    setRange({ since: from - 1, until: to, label: custom.from === custom.to && custom.from ? `Trong ngày ${day(from)}` : `Từ ${from ? day(from) : "…"} đến ${day(to - 1)}` });
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-background">
      <div className="relative flex h-16 shrink-0 items-center justify-center border-b font-semibold">
        Tìm kiếm trong trò chuyện
        <Button variant="ghost" size="icon-sm" className="absolute right-2" title="Đóng" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="flex flex-col gap-2 border-b p-3">
        <Input autoFocus placeholder="Nhập từ khóa để tìm kiếm" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()} />
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Lọc theo:</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={sender ? "secondary" : "outline"} size="xs">
                {sender?.name ?? "Người gửi"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-72 w-56 overflow-y-auto">
              {sender && <DropdownMenuItem onSelect={() => setSender(undefined)}>Tất cả</DropdownMenuItem>}
              {people.map((p) => (
                <DropdownMenuItem key={p.uid} onSelect={() => setSender({ uid: p.uid, name: p.name })}>
                  <Avatar src={p.avatar} name={p.name} size={24} /> <span className="truncate">{p.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={range ? "secondary" : "outline"} size="xs">
                {range?.label ?? "Ngày gửi"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60">
              {range && <DropdownMenuItem onSelect={() => setRange(undefined)}>Tất cả</DropdownMenuItem>}
              <div className="px-2 py-1 text-xs text-muted-foreground">Gợi ý thời gian</div>
              {PRESETS.map(([label, days]) => (
                <DropdownMenuItem key={label} onSelect={() => preset(label, days)}>
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <div className="flex flex-col gap-1 px-2 py-1 text-xs" onKeyDown={(e) => e.stopPropagation()}>
                Chọn khoảng thời gian
                <label className="flex items-center justify-between gap-2">
                  Từ ngày <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                </label>
                <label className="flex items-center justify-between gap-2">
                  Đến ngày <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
                </label>
              </div>
              <DropdownMenuItem disabled={!custom.from && !custom.to} onSelect={applyCustom}>
                Áp dụng
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <p className="p-4 text-center text-xs text-red-600">{error}</p>
        ) : !results ? (
          <p className="p-4 text-center text-xs text-muted-foreground">Hãy nhập từ khóa để bắt đầu tìm kiếm tin nhắn và file trong trò chuyện</p>
        ) : !results.length ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            Không tìm thấy kết quả
            <br />
            Vui lòng thử lại từ khóa khác
          </p>
        ) : (
          <>
            {results.map((m) => (
              <button key={m.msgId} className="flex w-full gap-2.5 px-3 py-2 text-left hover:bg-muted" onClick={() => onJump(m.msgId)}>
                <Avatar name={m.fromUid === accountId ? "Bạn" : (m.dName ?? "?")} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2 text-xs">
                    <b className="truncate">{m.fromUid === accountId ? "Bạn" : m.dName}</b>
                    <span className="shrink-0 text-muted-foreground">{day(m.sendDttm)}</span>
                  </div>
                  <div className="line-clamp-2 text-[13px] break-words">
                    {markWords(summary(m.msgType, m.content), q).map((part, i) => (part.hit ? <mark key={i} className="bg-amber-200">{part.text}</mark> : part.text))}
                  </div>
                </div>
              </button>
            ))}
            {more && (
              <div className="p-3">
                <Button variant="secondary" className="w-full" onClick={loadMore}>
                  Xem thêm
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
