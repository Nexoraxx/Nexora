import { useState } from "react";
import type { Pin } from "@/shared/types";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";

// Zalo PC when the pin list is full: "Cập nhật danh sách ghim", the oldest pin ticked to make room
export function ReplacePinDialog({ pins, onConfirm, onClose }: { pins: Pin[]; onConfirm: (old: Pin) => void; onClose: () => void }) {
  const [old, setOld] = useState(() => [...pins].sort((a, b) => (a.createTime ?? 0) - (b.createTime ?? 0))[0]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[380px]">
        <DialogTitle>Cập nhật danh sách ghim</DialogTitle>
        <DialogDescription>Ghim cũ dưới đây sẽ được bỏ để cập nhật nội dung mới.</DialogDescription>
        <div className="max-h-60 overflow-y-auto">
          {pins.map((p) => (
            <label key={p.topicId} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-muted">
              <Checkbox checked={old?.topicId === p.topicId} onCheckedChange={() => setOld(p)} />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold">{p.senderName ?? "Tin nhắn được ghim"}</div>
                <div className="truncate text-xs text-muted-foreground">{p.title}</div>
              </div>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!old} onClick={() => onConfirm(old)}>
            Xác nhận
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
