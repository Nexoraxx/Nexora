import { useState } from "react";
import { ttlText } from "@/app/chat/utils/chat.utils";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";

// Zalo PC ttl.durations (ms); 0 = "Không bao giờ"
const TTL = [3_600_000, 86_400_000, 604_800_000, 1_209_600_000, 0];

// Zalo PC "Cài đặt tin nhắn tự xóa"
export function AutoDeleteDialog({ current, onSave, onClose }: { current: number; onSave: (ttl: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(current);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[336px]">
        <DialogTitle>Cài đặt tin nhắn tự xóa</DialogTitle>
        <DialogDescription>
          Từ giờ, các tin nhắn mới trong trò chuyện này sẽ tự xóa sau khoảng thời gian được thiết lập. Người nhận vẫn có thể lưu hoặc chia sẻ những tin nhắn
          này trước khi tự xóa.
        </DialogDescription>
        <RadioGroup value={String(value)} onValueChange={(v) => setValue(Number(v))}>
          {TTL.map((ms) => (
            <div key={ms} className="flex items-center gap-2">
              <RadioGroupItem id={`ttl-${ms}`} value={String(ms)} />
              <Label htmlFor={`ttl-${ms}`}>{ms ? ttlText(ms) : "Không bao giờ"}</Label>
            </div>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={value === current} onClick={() => onSave(value)}>
            Xác nhận
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
