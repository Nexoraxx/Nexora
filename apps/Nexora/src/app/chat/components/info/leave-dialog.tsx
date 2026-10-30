import { useState } from "react";
import type { GroupMember } from "@/shared/types";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";

// "Rời nhóm": its messages go too; silently, only owner and deputies are told. An owner may pick the new owner,
// otherwise Zalo picks one at random.
export function LeaveDialog({
  owner,
  members,
  onLeave,
  onClose,
}: {
  owner: boolean;
  members: GroupMember[];
  onLeave: (silent: boolean, newOwnerId?: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [silent, setSilent] = useState(false);
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const leave = () => {
    setBusy(true);
    onLeave(silent, next || undefined).catch((e) => (setError(e.message), setBusy(false)));
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[400px]">
        <DialogTitle>Rời nhóm và xóa trò chuyện?</DialogTitle>
        <DialogDescription>
          {owner
            ? "Rời nhóm sẽ xóa toàn bộ tin nhắn. Quyền trưởng nhóm sẽ được trao ngẫu nhiên cho thành viên khác, hoặc bạn có thể chọn trưởng nhóm mới"
            : "Rời nhóm sẽ đồng thời xóa toàn bộ tin nhắn của nhóm đó. Bạn có muốn tiếp tục?"}
        </DialogDescription>
        {owner && (
          <label className="flex flex-col gap-1 text-sm">
            Chọn trưởng nhóm mới
            <select className="h-8 rounded-md border bg-background px-2" value={next} onChange={(e) => setNext(e.target.value)}>
              <option value="">Ngẫu nhiên</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox className="mt-0.5" checked={silent} onCheckedChange={(v) => setSilent(v === true)} />
          <span>
            Rời nhóm trong im lặng
            <span className="block text-xs text-muted-foreground">Chỉ trưởng/phó nhóm biết bạn rời nhóm.</span>
          </span>
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="destructive" disabled={busy} onClick={leave}>
            Rời nhóm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
