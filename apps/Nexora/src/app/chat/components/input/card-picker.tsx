import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import type { Friend } from "@/shared/types";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { fold } from "@/shared/utils/text.utils";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";

// Zalo PC: at most 9 cards at once; "Gửi kèm số điện thoại" is remembered
const MAX_CARDS = 9;
const WITH_PHONE = "nexora.cardWithPhone";
const collator = new Intl.Collator("vi");

// Zalo PC "Gửi danh thiếp": pick friends, optionally with their phone numbers
export function CardPicker({ accountId, onSend, onClose }: { accountId: string; onSend: (userIds: string[], withPhone: boolean) => Promise<unknown>; onClose: () => void }) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [withPhone, setWithPhone] = useState(localStorage.getItem(WITH_PHONE) === "1");
  const [note, setNote] = useState<string>();
  const [sending, setSending] = useState(false);
  useEffect(() => {
    api<Friend[]>(`/accounts/${accountId}/friends`)
      .then((list) => setFriends(list.sort((a, b) => collator.compare(a.alias || a.displayName, b.alias || b.displayName))))
      .catch((e) => setNote(e.message));
  }, []);

  const toggle = (id: string) => {
    if (picked.includes(id)) return setPicked((p) => p.filter((x) => x !== id));
    if (picked.length >= MAX_CARDS) return setNote(`Bạn chỉ có thể chia sẻ ${MAX_CARDS} danh thiếp`);
    setNote(undefined);
    setPicked((p) => [...p, id]);
  };
  const send = () => {
    localStorage.setItem(WITH_PHONE, withPhone ? "1" : "0");
    setSending(true);
    onSend(picked, withPhone)
      .then(onClose)
      .catch((e) => setNote(e.message))
      .finally(() => setSending(false));
  };
  const shown = friends.filter((f) => fold(`${f.alias ?? ""} ${f.displayName}`).includes(fold(q.trim())));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[400px]">
        <DialogTitle>Gửi danh thiếp</DialogTitle>
        <Input autoFocus placeholder="Tìm danh thiếp theo tên" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-80 overflow-y-auto">
          {shown.map((f) => (
            <label key={f.userId} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-muted">
              <Checkbox checked={picked.includes(f.userId)} onCheckedChange={() => toggle(f.userId)} />
              <Avatar src={f.avatar} name={f.alias || f.displayName} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate">{f.alias || f.displayName}</div>
                {f.phoneNumber && <div className="text-xs text-muted-foreground">{f.phoneNumber}</div>}
              </div>
            </label>
          ))}
        </div>
        {note && <p className="text-xs text-red-600">{note}</p>}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={withPhone} onCheckedChange={(v) => setWithPhone(v === true)} /> Gửi kèm số điện thoại
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!picked.length || sending} onClick={send}>
            Gửi danh thiếp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
