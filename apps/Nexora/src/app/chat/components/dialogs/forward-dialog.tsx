import { useState } from "react";
import { api } from "@/core/http/api";
import type { MessageRow, Thread } from "@/shared/types";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { QUOTE } from "@/app/chat/constants/chat.constants";
import { summary } from "@/app/chat/utils/chat.utils";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";

export function ForwardDialog({ base, message, threads, onClose }: { base: string; message: MessageRow; threads: Thread[]; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [result, setResult] = useState<string>();
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[380px]">
        <DialogTitle>Chia sẻ</DialogTitle>
        <div className={QUOTE}>{summary(message.msgType, message.content)}</div>
        <div className="max-h-75 overflow-y-auto">
          {threads.map((t) => (
            <label key={t.threadId} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-muted">
              <Checkbox checked={picked.includes(t.threadId)} onCheckedChange={() => toggle(t.threadId)} />
              <Avatar src={t.avatar} name={t.name ?? "?"} size={32} />
              <span className="min-w-0 flex-1">{t.name ?? t.threadId}</span>
            </label>
          ))}
        </div>
        {result && <div className="text-xs text-muted-foreground">{result}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button
            disabled={!picked.length}
            onClick={() =>
              api<{ success: unknown[]; fail: unknown[] }>(`${base}/messages/${message.msgId}/forward`, "POST", { to: picked })
                .then((r) => (r.fail.length ? setResult(`Gửi được ${r.success.length}, lỗi ${r.fail.length}`) : onClose()))
                .catch((e) => setResult(e.message))
            }
          >
            Gửi ({picked.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
