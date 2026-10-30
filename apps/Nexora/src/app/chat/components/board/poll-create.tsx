import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { api } from "@/core/http/api";
import { useAction } from "@/app/chat/hooks/useAction";
import { MAX_OPTION, MUTED } from "@/app/chat/constants/board.constants";
import { toLocal } from "@/app/chat/utils/board.utils";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils/shadcn";

// Zalo PC groupPoll limits; notes and reminders hold up to 3000 characters
const MAX_QUESTION = 200;

const MAX_OPTIONS = 30;

// Zalo PC "Tạo bình chọn"
export function PollCreate({ base, onClose }: { base: string; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [expires, setExpires] = useState("");
  const [flags, setFlags] = useState({ pin: false, allowMultiChoices: true, allowAddNewOption: true, hideVotePreview: false, isAnonymous: false });
  const { busy, error, act } = useAction();
  const flag = (key: keyof typeof flags, label: string, disabled = false) => (
    <label className={cn("flex items-center gap-2 text-sm", disabled && "opacity-50")}>
      <Checkbox disabled={disabled} checked={flags[key] && !disabled} onCheckedChange={(v) => setFlags({ ...flags, [key]: v === true })} /> {label}
    </label>
  );
  const create = () =>
    act(() => api(`${base}/polls`, "POST", { question, options, expiredTime: expires ? new Date(expires).getTime() : 0, ...flags }), onClose);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[440px]">
        <DialogTitle>Tạo bình chọn</DialogTitle>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Chủ đề bình chọn
            <Textarea autoFocus rows={2} maxLength={MAX_QUESTION} placeholder="Đặt câu hỏi bình chọn" value={question} onChange={(e) => setQuestion(e.target.value)} />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Các lựa chọn</span>
            {options.map((o, i) => (
              <div key={i} className="flex gap-1">
                <Input maxLength={MAX_OPTION} placeholder={`Lựa chọn ${i + 1}`} value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
                {options.length > 2 && (
                  <Button variant="ghost" size="icon" title="Xóa lựa chọn" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                    <XIcon />
                  </Button>
                )}
              </div>
            ))}
            {options.length < MAX_OPTIONS && (
              <Button variant="ghost" className="self-start" onClick={() => setOptions([...options, ""])}>
                <PlusIcon /> Thêm lựa chọn
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Thiết lập nâng cao</span>
            {flag("pin", "Ghim lên đầu trò chuyện")}
            {flag("allowMultiChoices", "Chọn nhiều phương án")}
            {flag("allowAddNewOption", "Có thể thêm phương án", flags.hideVotePreview)}
            {flag("hideVotePreview", "Ẩn kết quả khi chưa bình chọn")}
            {flag("isAnonymous", "Ẩn người bình chọn")}
            <label className="flex flex-col gap-1 text-sm">
              Thời hạn bình chọn
              <Input type="datetime-local" min={toLocal(Date.now())} value={expires} onChange={(e) => setExpires(e.target.value)} />
              <span className={MUTED}>{expires ? "" : "Không thời hạn"}</span>
            </label>
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={busy || !question.trim()} onClick={create}>
            Tạo bình chọn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
