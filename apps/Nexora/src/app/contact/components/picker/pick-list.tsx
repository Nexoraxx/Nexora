import { useState, type ReactNode } from "react";
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
      <DialogContent aria-describedby={undefined} className="w-[420px]">
        <DialogTitle>{title}</DialogTitle>
        {children}
        <Input autoFocus placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
        {selectAll && free.length > 0 && (
          <label className="flex cursor-pointer items-center gap-3 rounded-lg p-2 font-medium hover:bg-muted">
            <Checkbox
              checked={ticked === free.length ? true : ticked ? "indeterminate" : false}
              onCheckedChange={() => setPicked((p) => (ticked === free.length ? p.filter((id) => !free.includes(id)) : [...new Set([...p, ...free])]))}
            />
            {q.trim() ? `Chọn tất cả kết quả (${free.length})` : `Chọn tất cả (${free.length})`}
          </label>
        )}
        <div className="max-h-80 overflow-y-auto">
          {shown.map((i) => {
            const joined = taken.includes(i.id);
            return (
              <label key={i.id} className={cn("flex items-center gap-3 rounded-lg p-2", joined ? "opacity-60" : "cursor-pointer hover:bg-muted")}>
                <Checkbox disabled={joined} checked={joined || picked.includes(i.id)} onCheckedChange={() => toggle(i.id)} />
                <Avatar src={i.avatar} name={i.name} size={36} />
                <span className="min-w-0 flex-1 truncate">{i.name}</span>
                {joined && <span className={MUTED}>Đã tham gia</span>}
              </label>
            );
          })}
        </div>
        {(note ?? error) && <p className="text-xs text-red-600">{note ?? error}</p>}
        <DialogFooter>
          {selectAll && <span className="mr-auto self-center text-xs text-muted-foreground">Đã chọn {picked.length}</span>}
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={picked.length < min || busy} onClick={submit}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
