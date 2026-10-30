import { useState } from "react";
import type { QuickMessage } from "@/shared/types";
import { fold } from "@/shared/utils/text.utils";
import { MUTED } from "@/app/settings/constants/quick-message.constants";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";

// Zalo PC quick_message: max_keyword_length, max_msg_content_size (UTF-8 bytes), warning_remain_characters
const MAX_KEYWORD = 20;
const MAX_BYTES = 2800;
const WARN_REMAIN = 10;

const bytes = (s: string) => new TextEncoder().encode(s).length;

// Zalo PC's form: the keyword keeps letters and digits only (accents dropped), the text at most 2800 bytes;
// an item's photo stays as it is
export function QuickMessageForm({ item, onSave, onClose }: { item?: QuickMessage; onSave: (body: { keyword: string; title: string }) => Promise<unknown>; onClose: () => void }) {
  const [keyword, setKeyword] = useState(item?.keyword ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const remain = MAX_BYTES - bytes(title);

  const save = () => {
    setBusy(true);
    setError(undefined);
    onSave({ keyword, title }).catch((e) => (setError(e.message), setBusy(false)));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[380px]">
        <DialogTitle>{item ? "Chỉnh sửa tin nhắn nhanh" : "Tạo tin nhắn nhanh"}</DialogTitle>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-muted-foreground">/</span>
          <Input
            autoFocus
            placeholder="Phím tắt (Ví dụ: xinchao)"
            title="Phím tắt chỉ gồm chữ cái và chữ số."
            value={keyword}
            onChange={(e) => setKeyword(fold(e.target.value).replace(/[^A-Za-z0-9]/g, "").slice(0, MAX_KEYWORD))}
          />
          <span className={MUTED}>
            {keyword.length}/{MAX_KEYWORD}
          </span>
        </div>
        <Textarea
          rows={5}
          placeholder="Nhập nội dung tin nhắn"
          value={title}
          onChange={(e) => {
            let next = e.target.value.replace(/\r\n/g, "\n");
            while (bytes(next) > MAX_BYTES) next = next.slice(0, -1);
            setTitle(next);
          }}
        />
        {remain <= WARN_REMAIN && <span className={MUTED}>{remain} (kí tự còn lại)</span>}
        {item?.photo && (
          <div className="flex items-center gap-2">
            <img className="size-14 rounded object-cover" src={item.photo} alt="" />
            <span className={MUTED}>Ảnh được chọn</span>
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!keyword || !(title.trim() || item?.photo) || busy} onClick={save}>
            {item ? "Lưu" : "Thêm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
