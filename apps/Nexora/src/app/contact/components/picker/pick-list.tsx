import { useState, type ReactNode } from "react";
import { SearchIcon, UsersIcon, XIcon } from "lucide-react";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { fold } from "@/shared/utils/text.utils";
import { MUTED } from "@/app/contact/constants/group.constants";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils/shadcn";

type PickItem = { id: string; name: string; avatar: string; search: string };

// Zalo PC's compose picker: search (accents optional), tick, confirm; `taken` ones show ticked and locked
export function PickList({
  title,
  placeholder,
  confirm,
  min,
  items,
  taken,
  initial = [],
  children,
  error,
  selectAll,
  onConfirm,
  onClose,
}: {
  title: string;
  placeholder: string;
  confirm: string;
  min: number;
  items: PickItem[];
  taken: string[];
  // ticked at the start, still changeable
  initial?: string[];
  children?: ReactNode;
  error?: string;
  // a "Chọn tất cả" row over what the search shows, and the count picked by the buttons
  selectAll?: boolean;
  onConfirm: (ids: string[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>(initial);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const submit = () => {
    setBusy(true);
    setNote(undefined);
    onConfirm(picked)
      .catch((e) => setNote(e.message))
      .finally(() => setBusy(false));
  };
  const shown = items.filter((i) => fold(i.search).includes(fold(q.trim())));
  const free = shown.filter((i) => !taken.includes(i.id)).map((i) => i.id);
  const ticked = free.filter((id) => picked.includes(id)).length;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[480px] sm:max-w-[480px] gap-3 p-5">
        <DialogTitle className="text-base font-semibold tracking-tight">{title}</DialogTitle>
        {children}
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            autoFocus
            placeholder={placeholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9 pr-8 h-9 text-xs rounded-lg bg-muted/30 focus-visible:bg-background transition-colors"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer transition-colors"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
        {selectAll && free.length > 0 && (
          <label className="flex cursor-pointer items-center justify-between rounded-lg bg-muted/40 hover:bg-muted/70 px-3 py-2 text-xs font-medium text-foreground transition-colors border border-border/50">
            <div className="flex items-center gap-2.5">
              <Checkbox
                checked={ticked === free.length ? true : ticked ? "indeterminate" : false}
                onCheckedChange={() => setPicked((p) => (ticked === free.length ? p.filter((id) => !free.includes(id)) : [...new Set([...p, ...free])]))}
              />
              <span>{q.trim() ? `Chọn tất cả kết quả tìm kiếm` : `Chọn tất cả danh sách này`}</span>
            </div>
            <span className="text-[11px] font-mono font-medium text-muted-foreground bg-background px-1.5 py-0.5 rounded border border-border/60">
              {free.length}
            </span>
          </label>
        )}
        <div className="max-h-80 min-h-36 overflow-y-auto space-y-0.5 pr-1 -mr-1">
          {shown.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              <UsersIcon className="size-8 mx-auto mb-2 opacity-30 stroke-[1.5]" />
              <p className="font-medium text-foreground/80">Không tìm thấy người nhận nào</p>
              <p className="text-[11px] opacity-75 mt-0.5">Thử tìm bằng tên khác hoặc đổi thẻ phân loại</p>
            </div>
          ) : (
            shown.map((i) => {
              const joined = taken.includes(i.id);
              const active = picked.includes(i.id);
              return (
                <label
                  key={i.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-2.5 py-2 transition-all",
                    joined
                      ? "opacity-50 cursor-not-allowed"
                      : active
                        ? "bg-primary/5 hover:bg-primary/8 cursor-pointer"
                        : "cursor-pointer hover:bg-muted/60 active:scale-[0.99]"
                  )}
                >
                  <Checkbox disabled={joined} checked={joined || active} onCheckedChange={() => toggle(i.id)} />
                  <Avatar src={i.avatar} name={i.name} size={36} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{i.name}</span>
                  {joined && <span className={MUTED}>Đã tham gia</span>}
                </label>
              );
            })
          )}
        </div>
        {(note ?? error) && <p className="text-xs text-destructive bg-destructive/10 px-2.5 py-1.5 rounded-lg">{note ?? error}</p>}
        <DialogFooter className="flex items-center justify-between sm:justify-between border-t pt-3">
          {selectAll && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Đã chọn:</span>
              <span className="font-semibold font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-full text-[11px]">
                {picked.length}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={onClose}>
              Hủy
            </Button>
            <Button size="sm" disabled={picked.length < min || busy} onClick={submit} className="font-medium">
              {confirm}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
