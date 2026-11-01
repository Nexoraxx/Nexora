import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import type { Sticker } from "@/shared/types";
import { matchStickerKeyword } from "@/shared/utils/text.utils";
import { StickerCell } from "@/app/chat/components/input/sticker-cell";
import { XIcon } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

type Keywords = { set: Set<string>; maxWords: number };
// the keyword list is fetched once per account and session
const keywordsByAccount = new Map<string, Promise<Keywords>>();
const loadKeywords = (accountId: string) => {
  let keywords = keywordsByAccount.get(accountId);
  if (!keywords) {
    keywords = api<{ keywords: string[]; maxWords: number }>(`/accounts/${accountId}/stickers/suggest/keywords`).then((r) => ({
      set: new Set(r.keywords.map((k) => k.toLowerCase())),
      maxWords: r.maxWords,
    }));
    keywords.catch(() => keywordsByAccount.delete(accountId));
    keywordsByAccount.set(accountId, keywords);
  }
  return keywords;
};

// Zalo PC: stickers for the keyword just typed, above the input; ✕ hides them until the keyword changes.
export function StickerSuggestions({ accountId, text, caret, onPick }: { accountId: string; text: string; caret: number; onPick: (s: Sticker) => void }) {
  const [keywords, setKeywords] = useState<Keywords>();
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [dismissed, setDismissed] = useState("");
  const keyword = keywords ? matchStickerKeyword(text, caret, keywords.set, keywords.maxWords) : "";

  useEffect(() => void loadKeywords(accountId).then(setKeywords).catch(() => {}), [accountId]);

  useEffect(() => {
    setStickers([]);
    if (!keyword || keyword === dismissed) return;
    const t = setTimeout(
      () =>
        api<Sticker[]>(`/accounts/${accountId}/stickers/suggest?keyword=${encodeURIComponent(keyword)}`)
          .then(setStickers)
          .catch(() => {}),
      300,
    );
    return () => clearTimeout(t);
  }, [keyword, dismissed]);

  if (!stickers.length) return null;
  return (
    <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border bg-white dark:bg-popover dark:border-border/80 p-1 shadow-md">
      {stickers.map((s) => (
        <StickerCell key={`${s.cateId}-${s.id}`} sticker={s} onClick={() => onPick(s)} />
      ))}
      <Button variant="ghost" size="icon-sm" title="Ẩn gợi ý" onClick={() => setDismissed(keyword)}>
        <XIcon />
      </Button>
    </div>
  );
}
