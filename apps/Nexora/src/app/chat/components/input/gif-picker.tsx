import { useEffect, useRef, useState } from "react";
import { api } from "@/core/http/api";
import type { Gif } from "@/shared/types";
import { Input } from "@/shared/components/ui/input";
import { Img } from "@/shared/components/img";

// Zalo PC's GIF tab: "Xu hướng" until 2+ characters are typed, then search (200ms); more load at the bottom
export function GifPicker({ accountId, onPick }: { accountId: string; onPick: (g: Gif) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Gif[]>();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const loading = useRef(false);
  const keyword = q.trim().length >= 2 ? q.trim() : "";

  const load = (offset: number) => {
    loading.current = true;
    return api<Gif[]>(`/accounts/${accountId}/gifs?q=${encodeURIComponent(keyword)}&offset=${offset}`)
      .then((r) => (setItems((cur) => (offset ? [...(cur ?? []), ...r] : r)), setDone(!r.length)))
      .catch((e) => setError(e.message))
      .finally(() => (loading.current = false));
  };
  useEffect(() => {
    setError(undefined);
    const t = setTimeout(() => (setItems(undefined), load(0)), 200);
    return () => clearTimeout(t);
  }, [keyword]);

  return (
    <div>
      <Input autoFocus placeholder="Tìm kiếm GIF" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <div className="text-xs text-muted-foreground">{error}</div>}
      {!keyword && <div className="pt-1.5 text-xs font-semibold text-muted-foreground">Xu hướng</div>}
      <div
        className="mt-1.5 grid h-50 grid-cols-3 content-start gap-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (!done && !loading.current && items && el.scrollTop + el.clientHeight >= el.scrollHeight - 40) load(items.length);
        }}
      >
        {!items ? (
          <span className="text-xs text-muted-foreground">Đang tải…</span>
        ) : !items.length ? (
          <span className="text-xs text-muted-foreground">Không có GIF</span>
        ) : (
          items.map((g, i) => (
            <button key={`${g.id}-${i}`} className="h-24 overflow-hidden rounded bg-muted" onClick={() => onPick(g)}>
              <Img className="size-full object-cover" src={g.thumb} alt="GIF" loading="lazy" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
