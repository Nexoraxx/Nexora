import { useState } from "react";
import { api } from "@/core/http/api";
import { PinDialog } from "@/app/chat/components/dialogs/pin-dialog";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";

// "Ẩn trò chuyện": with no PIN yet, "Đặt mã PIN" then "Xác nhận lại mã PIN"; otherwise "Nhập mã PIN để ẩn trò chuyện"
export function HideDialog({ accountId, threadId, isGroup, name, hasPin, onClose }: { accountId: string; threadId: string; isGroup: boolean; name: string; hasPin: boolean; onClose: () => void }) {
  const [step, setStep] = useState<"intro" | "create" | "confirm" | "enter" | "done">(hasPin ? "enter" : "intro");
  const [first, setFirst] = useState("");
  const hide = (pin: string) => api(`/accounts/${accountId}/conversations/${threadId}/hidden`, "PUT", { isGroup, hidden: true, pin }).then(() => setStep("done"));
  if (step === "intro")
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="w-[380px]">
          <DialogTitle>Ẩn trò chuyện</DialogTitle>
          <DialogDescription>Trò chuyện sẽ được ẩn khỏi danh sách tin nhắn. Chỉ có bạn mới có thể tìm thấy và mở lại chúng bằng cách sử dụng mã PIN.</DialogDescription>
          <DialogFooter>
            <Button onClick={() => setStep("create")}>Đặt mã PIN</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  if (step === "done")
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="w-[380px]">
          <DialogTitle>Ẩn trò chuyện thành công</DialogTitle>
          <DialogDescription>
            Bạn đã ẩn trò chuyện <b>{name}</b> thành công. Để mở các trò chuyện đã ẩn, bạn có thể nhập mã PIN đã cài đặt hoặc tên trò chuyện ẩn tại khung tìm kiếm.
          </DialogDescription>
          <DialogFooter>
            <Button onClick={onClose}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  if (step === "create")
    return (
      <PinDialog title="Đặt mã PIN" description="Nhập mã PIN" note="Ghi nhớ mã PIN để xem lại trò chuyện. Trò chuyện sẽ mất nếu bạn cài đặt lại mã PIN." onSubmit={async (pin) => (setFirst(pin), setStep("confirm"))} onClose={onClose} />
    );
  if (step === "confirm")
    return (
      <PinDialog
        key="confirm"
        title="Xác nhận lại mã PIN"
        description="Nhập lại mã PIN của bạn"
        onSubmit={async (pin) => {
          if (pin !== first) throw new Error("Mã PIN không khớp. Vui lòng thử lại.");
          await hide(pin);
        }}
        onClose={onClose}
      />
    );
  return <PinDialog title="Ẩn trò chuyện" description="Nhập mã PIN để ẩn trò chuyện" onSubmit={hide} onClose={onClose} />;
}
