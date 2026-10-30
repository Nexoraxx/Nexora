import { useState } from "react";
import { api } from "@/core/http/api";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";

export function DeleteDialog({ accountId, threadId, onDeleted, onClose }: { accountId: string; threadId: string; onDeleted: () => void; onClose: () => void }) {
  const [error, setError] = useState<string>();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[380px]">
        <DialogTitle>Xóa hội thoại</DialogTitle>
        <DialogDescription>Bạn có muốn xóa lịch sử trò chuyện này? Tin nhắn chỉ bị xóa ở phía bạn.</DialogDescription>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Không
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              api(`/accounts/${accountId}/conversations/${threadId}`, "DELETE")
                .then(() => (onDeleted(), onClose()))
                .catch((e) => setError(e.message))
            }
          >
            Xóa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
