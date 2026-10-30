import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import type { Gif, Sticker, StickerCategory } from "@/shared/types";
import { GifPicker } from "@/app/chat/components/input/gif-picker";
import { StickerCell } from "@/app/chat/components/input/sticker-cell";
import { ClockIcon, PlusIcon, SearchIcon } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

type StickerTab = { kind: "recent" } | { kind: "category"; id: number } | { kind: "search" } | { kind: "store" } | { kind: "gif" };

// Zalo PC's sticker panel: recents, the account's own categories, search and the store to add/remove categories,
// plus the GIF tab.
export function StickerPicker({ accountId, onPick, onGif }: { accountId: string; onPick: (s: Sticker) => void; onGif: (g: Gif) => void }) {
  const [categories, setCategories] = useState<StickerCategory[]>([]);
  const [tab, setTab] = useState<StickerTab>({ kind: "recent" });
  const [items, setItems] = useState<Sticker[]>();
  const [store, setStore] = useState<StickerCategory[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string>();
  const base = `/accounts/${accountId}/stickers`;
  const fail = (e: Error) => setError(e.message);

  const loadCategories = () => api<StickerCategory[]>(`${base}/categories`).then(setCategories).catch(fail);
  useEffect(() => void loadCategories(), []);

  useEffect(() => {
    setError(undefined);
    setItems(undefined);
    if (tab.kind === "recent") api<Sticker[]>(`${base}/recent`).then(setItems).catch(fail);
    else if (tab.kind === "category") api<Sticker[]>(`${base}/categories/${tab.id}`).then(setItems).catch(fail);
    else if (tab.kind === "store") api<StickerCategory[]>(`${base}/store`).then(setStore).catch(fail);
  }, [tab]);

  useEffect(() => {
    if (tab.kind !== "search" || !q.trim()) return;
    const t = setTimeout(() => api<Sticker[]>(`${base}/search?q=${encodeURIComponent(q.trim())}`).then(setItems).catch(fail), 300);
    return () => clearTimeout(t);
  }, [q, tab]);

  const toggle = (c: StickerCategory) =>
    api(`${base}/categories/${c.id}`, c.added ? "DELETE" : "PUT")
      .then(() => (setStore((s) => s.map((x) => (x.id === c.id ? { ...x, added: !x.added } : x))), loadCategories()))
      .catch(fail);
  const isTab = (t: StickerTab) => t.kind === tab.kind && (t.kind !== "category" || (tab.kind === "category" && tab.id === t.id));

  return (
    <div className="mb-2 border-b pb-2">
      {tab.kind === "search" && <Input autoFocus placeholder="Tìm sticker (vd: hi, yêu, buồn)" value={q} onChange={(e) => setQ(e.target.value)} />}
      {error && <div className="text-xs text-muted-foreground">{error}</div>}
      {tab.kind === "gif" ? (
        <GifPicker accountId={accountId} onPick={onGif} />
      ) : tab.kind === "store" ? (
        <div className="mt-1.5 h-50 overflow-y-auto">
          {store.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted">
              <img className="size-10" src={c.iconUrl} alt="" />
              <div className="min-w-0 flex-1">
                <div>{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.totalImage} sticker</div>
              </div>
              <Button variant={c.added ? "outline" : "default"} onClick={() => toggle(c)}>
                {c.added ? "Bỏ" : "Thêm"}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1.5 flex h-50 flex-wrap content-start gap-1 overflow-y-auto">
          {!items ? (
            tab.kind !== "search" && <span className="text-xs text-muted-foreground">Đang tải…</span>
          ) : items.length ? (
            items.map((s) => <StickerCell key={`${s.cateId}-${s.id}`} sticker={s} onClick={() => onPick(s)} />)
          ) : (
            <span className="text-xs text-muted-foreground">{tab.kind === "recent" ? "Chưa gửi sticker nào" : "Không có sticker"}</span>
          )}
        </div>
      )}
      <div className="mt-1.5 flex gap-0.5 overflow-x-auto border-t pt-1.5">
        <Button variant={isTab({ kind: "gif" }) ? "secondary" : "ghost"} size="icon" className="text-xs font-bold" title="GIF" onClick={() => setTab({ kind: "gif" })}>
          GIF
        </Button>
        <Button variant={isTab({ kind: "recent" }) ? "secondary" : "ghost"} size="icon" title="Gần đây" onClick={() => setTab({ kind: "recent" })}>
          <ClockIcon />
        </Button>
        {categories.map((c) => (
          <Button
            key={c.id}
            variant={isTab({ kind: "category", id: c.id }) ? "secondary" : "ghost"}
            size="icon"
            title={c.name}
            onClick={() => setTab({ kind: "category", id: c.id })}
          >
            <img className="size-6" src={c.iconUrl} alt={c.name} />
          </Button>
        ))}
        <Button variant={isTab({ kind: "search" }) ? "secondary" : "ghost"} size="icon" title="Tìm sticker" onClick={() => (setItems([]), setTab({ kind: "search" }))}>
          <SearchIcon />
        </Button>
        <Button variant={isTab({ kind: "store" }) ? "secondary" : "ghost"} size="icon" title="Kho sticker" onClick={() => setTab({ kind: "store" })}>
          <PlusIcon />
        </Button>
      </div>
    </div>
  );
}
