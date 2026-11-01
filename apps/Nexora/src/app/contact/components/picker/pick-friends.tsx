import { useEffect, useState, type ReactNode } from "react";
import { TagIcon } from "lucide-react";
import { api } from "@/core/http/api";
import type { ConversationSettings, Friend, Label } from "@/shared/types";
import { collator } from "@/app/contact/constants/group.constants";
import { PickList } from "@/app/contact/components/picker/pick-list";
import { cn } from "@/shared/utils/shadcn";

// Zalo PC's friend picker of "Tạo nhóm" and "Thêm thành viên"; members already in show ticked
export function PickFriends({
  accountId,
  title,
  confirm,
  min = 1,
  taken = [],
  initial,
  children,
  selectAll,
  skipBlocked,
  filterLabels,
  onConfirm,
  onClose,
}: {
  accountId: string;
  title: string;
  confirm: string;
  min?: number;
  taken?: string[];
  initial?: string[];
  children?: ReactNode;
  selectAll?: boolean;
  // friends this account blocked are left out
  skipBlocked?: boolean;
  filterLabels?: boolean;
  onConfirm: (userIds: string[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [selectedLabelId, setSelectedLabelId] = useState<number | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<Friend[]>(`/accounts/${accountId}/friends`)
      .then((list) => setFriends(list.sort((a, b) => collator.compare(a.alias || a.displayName, b.alias || b.displayName))))
      .catch((e) => setError(e.message));

    if (filterLabels) {
      api<ConversationSettings>(`/accounts/${accountId}/conversations`)
        .then((s) => setLabels(s.labels ?? []))
        .catch(() => {});
    }
  }, [accountId, filterLabels]);

  const activeLabel = labels.find((l) => l.id === selectedLabelId);
  const filteredFriends = activeLabel
    ? friends.filter((f) => activeLabel.conversations.includes(f.userId))
    : friends;

  const items = filteredFriends.filter((f) => !(skipBlocked && f.isBlocked)).map((f) => ({
    id: f.userId,
    name: f.alias || f.displayName,
    avatar: f.avatar,
    search: `${f.alias ?? ""} ${f.displayName} ${f.phoneNumber ?? ""}`,
  }));

  const labelFilterBar = filterLabels && labels.length > 0 && (
    <div className="flex items-center gap-1.5 overflow-x-auto py-1 -mt-1 scrollbar-none">
      <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 shrink-0 mr-0.5">
        <TagIcon className="size-3 text-muted-foreground/70" />
        <span>Thẻ:</span>
      </span>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 transition-all cursor-pointer border",
          selectedLabelId === null
            ? "bg-primary text-primary-foreground border-primary shadow-xs"
            : "bg-muted/50 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground"
        )}
        onClick={() => setSelectedLabelId(null)}
      >
        <span>Tất cả</span>
        <span className={cn("text-[10px] font-mono px-1 py-0.2 rounded-full", selectedLabelId === null ? "bg-white/20" : "bg-muted-foreground/15")}>
          {friends.length}
        </span>
      </button>
      {labels.map((l) => {
        const count = friends.filter((f) => l.conversations.includes(f.userId)).length;
        const active = selectedLabelId === l.id;
        return (
          <button
            key={l.id}
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 transition-all cursor-pointer border",
              active
                ? "text-white border-transparent shadow-xs"
                : "bg-muted/50 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground"
            )}
            style={active ? { backgroundColor: l.color } : undefined}
            onClick={() => setSelectedLabelId(active ? null : l.id)}
          >
            <span
              className={cn("size-2 rounded-full shrink-0 ring-1 ring-black/10", active && "bg-white")}
              style={active ? undefined : { backgroundColor: l.color }}
            />
            <span className="truncate max-w-28">{l.text}</span>
            <span className={cn("text-[10px] font-mono px-1 py-0.2 rounded-full", active ? "bg-white/25" : "bg-muted-foreground/15")}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <PickList title={title} placeholder="Nhập tên, số điện thoại" confirm={confirm} min={min} items={items} taken={taken} initial={initial} error={error} selectAll={selectAll} onConfirm={onConfirm} onClose={onClose}>
      {labelFilterBar}
      {children}
    </PickList>
  );
}
