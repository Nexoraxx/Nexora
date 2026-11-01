import type { QuickMessage } from "@/shared/types";
import { cn } from "@/shared/utils/shadcn";
import { Img } from "@/shared/components/img";

// PC's suggestion box: shown for any "/word" while the feature has items, even with no match
export function QuickSuggestions({ items, selected, onPick }: { items: QuickMessage[]; selected: number; onPick: (q: QuickMessage) => void }) {
  return (
    <div className="max-h-60 w-96 max-w-full overflow-y-auto rounded-lg border bg-white py-1 shadow-md">
      <p className="px-3 py-1 text-xs font-semibold text-muted-foreground">Tin nhắn nhanh</p>
      {!items.length && <p className="px-3 py-1.5 text-xs text-muted-foreground">Không có tin nhắn nhanh phù hợp. Vui lòng thử từ khóa khác</p>}
      {items.map((q, i) => (
        <button key={q.id} className={cn("flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-muted", i === selected && "bg-muted")} onClick={() => onPick(q)}>
          {q.photo && <Img className="size-7 rounded object-cover" src={q.photo} />}
          <span className="shrink-0 font-medium">/{q.keyword}</span>
          <span className="truncate text-muted-foreground">{q.title}</span>
        </button>
      ))}
    </div>
  );
}
