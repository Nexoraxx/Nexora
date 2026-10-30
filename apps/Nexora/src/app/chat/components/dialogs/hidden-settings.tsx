import { useState, type ReactNode } from "react";
import { api } from "@/core/http/api";
import { PinDialog } from "@/app/chat/components/dialogs/pin-dialog";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";

// "Thiết lập ẩn trò chuyện": change the PIN (old, new, again) or reset it, which deletes the hidden conversations
export function HiddenSettings({ accountId, hasPin, onClose }: { accountId: string; hasPin: boolean; onClose: () => void }) {
  const [step, setStep] = useState<"menu" | "old" | "new" | "again" | "reset">("menu");
  const [pins, setPins] = useState({ old: "", next: "" });
  const [error, setError] = useState<string>();
  const base = `/accounts/${accountId}/hidden-chats`;
  const pinStep = (title: string, description: string, onSubmit: (pin: string) => Promise<unknown>): ReactNode => (
    <PinDialog key={step} title={title} description={description} onSubmit={onSubmit} onClose={onClose} />
  );
  if (step === "old")
    return pinStep("Đổi mã PIN", "Nhập mã PIN cũ", (pin) => api(`${base}/verify`, "POST", { pin }).then(() => (setPins({ old: pin, next: "" }), setStep("new"))));
  if (step === "new") return pinStep("Đổi mã PIN", "Nhập mã PIN mới", async (pin) => (setPins((p) => ({ ...p, next: pin })), setStep("again")));
  if (step === "again")
    return pinStep("Đổi mã PIN", "Xác nhận lại mã PIN mới", async (pin) => {
      if (pin !== pins.next) throw new Error("Mã PIN không khớp. Vui lòng thử lại.");
      await api(`${base}/pin`, "PUT", { oldPin: pins.old, newPin: pin });
      onClose();
    });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[380px]">
        <DialogTitle>{step === "reset" ? "Đặt lại mã PIN" : "Thiết lập ẩn trò chuyện"}</DialogTitle>
        <DialogDescription>
          {step === "reset"
            ? "Khi đặt lại mã PIN, tất cả trò chuyện đang được ẩn sẽ bị xoá (bao gồm toàn bộ nội dung cuộc trò chuyện). Bạn có muốn tiếp tục?"
            : hasPin
              ? "Mã PIN: Bật. Quên mã PIN? Bạn phải cài đặt lại mã."
              : "Mã PIN: Tắt. Mã PIN được đặt khi bạn ẩn trò chuyện đầu tiên."}
        </DialogDescription>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <DialogFooter>
          {step === "reset" ? (
            <>
              <Button variant="outline" onClick={() => setStep("menu")}>
                Không
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  api(`${base}/pin`, "DELETE")
                    .then(onClose)
                    .catch((e) => setError(e.message))
                }
              >
                Đặt lại
              </Button>
            </>
          ) : (
            hasPin && (
              <>
                <Button variant="outline" onClick={() => setStep("reset")}>
                  Đặt lại mã PIN
                </Button>
                <Button onClick={() => setStep("old")}>Đổi mã PIN</Button>
              </>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
