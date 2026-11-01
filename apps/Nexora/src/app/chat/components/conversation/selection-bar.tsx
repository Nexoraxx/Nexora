import { useState } from "react";
import { api } from "@/core/http/api";
import type { MessageRow } from "@/shared/types";
import { Button } from "@/shared/components/ui/button";

// Zalo PC's "Chọn nhiều tin nhắn" bar: "N Đã chọn", Sao chép, Thu hồi (own messages only, one request), Xóa, Hủy
export function SelectionBar({
  base,
  rows,
  me,
  online,
  recall,
  onCopy,
  onDeleted,
  onDone,
  onError,
}: {
  base: string;
  rows: MessageRow[];
  me: string;
  online: boolean;
  // "Cloud của tôi" has no recall
  recall: boolean;
  onCopy: (rows: MessageRow[]) => void;
  onDeleted: (msgIds: string[]) => void;
  onDone: () => void;
  onError: (e: string) => void;
}) {
  const [confirm, setConfirm] = useState<"undo" | "delete">();
  const [busy, setBusy] = useState(false);
  const canRecall = recall && online && rows.length > 0 && rows.every((m) => m.fromUid === me);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(undefined);
    }
  };
  const undo = () => act(() => api(`${base}/undo`, "POST", { msgIds: rows.map((m) => m.msgId) }).then(onDone));
  const remove = () =>
    act(async () => {
      for (const m of rows) await api(`${base}/messages/${m.msgId}`, "DELETE");
      onDeleted(rows.map((m) => m.msgId));
    });

  if (confirm)
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex-1">{confirm === "undo" ? "Thu hồi các tin nhắn đã chọn cho tất cả mọi người?" : "Xóa các tin nhắn đã chọn chỉ ở phía tôi?"}</span>
        <Button variant="outline" onClick={() => setConfirm(undefined)}>
          Không
        </Button>
        <Button variant={confirm === "delete" ? "destructive" : "default"} disabled={busy} onClick={confirm === "undo" ? undo : remove}>
          {confirm === "undo" ? "Thu hồi" : "Xóa"}
        </Button>
      </div>
    );
  return (
    <div className="flex items-center gap-1.5 px-3 py-2">
      <span className="flex-1">
        <b>{rows.length}</b> Đã chọn
      </span>
      <Button variant="outline" className="bg-white/60 dark:bg-card/70" disabled={!rows.length} onClick={() => onCopy(rows)}>
        Sao chép
      </Button>
      <Button variant="outline" className="bg-white/60 dark:bg-card/70" disabled={!canRecall} title={canRecall ? undefined : "Chỉ thu hồi được tin nhắn của bạn"} onClick={() => setConfirm("undo")}>
        Thu hồi
      </Button>
      <Button variant="destructive" disabled={!rows.length || !online} onClick={() => setConfirm("delete")}>
        Xóa
      </Button>
      <Button variant="ghost" onClick={onDone}>
        Hủy
      </Button>
    </div>
  );
}
