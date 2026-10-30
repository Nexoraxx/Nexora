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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[420px]">
        <DialogTitle>{title}</DialogTitle>
        {children}
        <Input autoFocus placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
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
