import { useState } from "react";
import { EyeOffIcon, LockIcon } from "lucide-react";
import { api } from "@/core/http/api";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";

type Step = "intro" | "upgrading" | "complete" | "pending" | { error: string };

// Zalo PC's E2EE onboarding then setup modals: what it does, "Nâng Cấp", then how the upgrade went
export function E2eeDialog({ base, threadId, name, onClose }: { base: string; threadId: string; name: string; onClose: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const upgrade = () => {
    setStep("upgrading");
    api<{ status: "complete" | "pending" }>(`${base}/conversations/${threadId}/e2ee`, "POST")
      .then((r) => setStep(r.status))
      .catch((e: Error) => setStep({ error: e.message }));
  };
  const outcome =
    step === "complete"
      ? { title: "Mã hóa thành công!", desc: "Từ giờ, tất cả các tin nhắn trong trò chuyện sẽ được bảo mật bằng mã hóa đầu cuối." }
      : step === "pending"
        ? { title: `Mã hóa hoàn tất khi ${name} truy cập Zalo`, desc: "Bạn vẫn có thể gửi được tin nhắn mã hóa trong khi chờ đợi" }
        : typeof step === "object"
          ? { title: "Nâng cấp Mã hóa không thành công", desc: step.error }
          : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && step !== "upgrading" && onClose()}>
      <DialogContent className="w-[380px]">
        {step === "intro" && (
          <>
            <DialogTitle>Mã hóa đầu cuối</DialogTitle>
            <div className="flex gap-3">
              <LockIcon className="size-6 shrink-0 text-primary" />
              <div>
                <div className="font-medium">Mã hóa tin nhắn toàn phần</div>
                <div className="text-sm text-muted-foreground">Tin nhắn được mã hóa xuyên suốt khi gửi và nhận</div>
              </div>
            </div>
            <div className="flex gap-3">
              <EyeOffIcon className="size-6 shrink-0 text-primary" />
              <div>
                <div className="font-medium">Bảo mật nội dung tin nhắn</div>
                <div className="text-sm text-muted-foreground">Chỉ thiết bị của người gửi và người nhận giải mã được tin nhắn</div>
              </div>
            </div>
            {/* Zalo trusts any key the server hands out (no key verification), so its E2EE can't stop Zalo itself */}
            <DialogDescription className="text-xs">Lưu ý: Zalo không cho kiểm tra khóa mã hóa của người nhận, nên không chống được việc chính máy chủ Zalo can thiệp.</DialogDescription>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Để lúc khác
              </Button>
              <Button onClick={upgrade}>Nâng Cấp</Button>
            </DialogFooter>
          </>
        )}
        {step === "upgrading" && (
          <>
            <DialogTitle>Đang mã hóa hội thoại này</DialogTitle>
            <DialogDescription>Nội dung tin nhắn sẽ được bảo mật khi quá trình mã hóa thành công, vui lòng chờ...</DialogDescription>
          </>
        )}
        {outcome && (
          <>
            <DialogTitle>{outcome.title}</DialogTitle>
            <DialogDescription>{outcome.desc}</DialogDescription>
            <DialogFooter>
              {typeof step === "object" && (
                <Button variant="outline" onClick={upgrade}>
                  Thử lại
                </Button>
              )}
              <Button onClick={onClose}>{typeof step === "object" ? "Đóng" : "Đã hiểu"}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
