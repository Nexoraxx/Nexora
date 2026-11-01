import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import type { SyncPhase, SyncState } from "@/shared/types";
import { MUTED } from "@/app/settings/constants/settings.constants";
import { Section } from "@/app/settings/components/fields/settings-section";
import { Button } from "@/shared/components/ui/button";

// Zalo PC's sync banner and popup texts (lang-vi STR_*SYNC_DB*), per step
const STEPS: Record<SyncPhase, { title: string; desc: string }> = {
  waiting_confirm: { title: "Xác nhận trên điện thoại để bắt đầu", desc: "Vui lòng mở ứng dụng Zalo trên điện thoại và ấn “Đồng bộ ngay” để bắt đầu đồng bộ tin nhắn." },
  preparing: { title: "Đang chuẩn bị dữ liệu từ điện thoại", desc: "Vui lòng giữ Zalo mở và không tắt màn hình điện thoại." },
  syncing: { title: "Đang đồng bộ tin nhắn...", desc: "Hãy giữ Zalo mở trên cả điện thoại và máy tính trong quá trình đồng bộ" },
  paused: { title: "Đồng bộ đã tạm dừng", desc: "Mở Zalo trên điện thoại để tiếp tục" },
  done: { title: "Đồng bộ tin nhắn thành công", desc: "Tin nhắn của bạn đã được đồng bộ với điện thoại." },
  error: { title: "Đồng bộ không thành công", desc: "Đã xảy ra lỗi trong quá trình đồng bộ. Vui lòng thử lại." },
};

// Zalo PC "Đồng bộ tin nhắn": the phone sends its conversations and their recent messages to this computer
export function SyncMessages({ accountId }: { accountId: string }) {
  const [sync, setSync] = useState<SyncState | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<SyncState | null>(`/accounts/${accountId}/sync`).then(setSync).catch(() => setSync(null));
    return onEvent((e) => e.type === "sync_status" && e.accountId === accountId && setSync(e));
  }, [accountId]);

  const run = (method: "POST" | "DELETE") => {
    setError(undefined);
    api<SyncState>(`/accounts/${accountId}/sync`, method)
      .then((s) => s && setSync(s))
      .catch((e: Error) => setError(e.message));
  };
  const busy = !!sync && sync.state !== "done" && sync.state !== "error";
  const step = sync && STEPS[sync.state];

  return (
    <Section title="Đồng bộ tin nhắn từ điện thoại">
      <div className="space-y-3 px-3 py-3">
        <div className={MUTED}>
          Zalo sẽ đồng bộ toàn bộ các hội thoại từ điện thoại lên máy tính này.
          <br />
          Vui lòng chuẩn bị sẵn điện thoại đã đăng nhập tài khoản Zalo của bạn.
        </div>
        {sync && step && (
          <div className="rounded-md bg-muted/50 px-3 py-2" role="status">
            <div className="font-medium">
              {step.title}
              {sync.state === "syncing" && sync.progress !== undefined && ` ${sync.progress}%`}
            </div>
            <div className={MUTED}>{sync.state === "error" && sync.error ? sync.error : step.desc}</div>
            {sync.state === "syncing" && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-[width]" style={{ width: `${sync.progress ?? 0}%` }} />
              </div>
            )}
            {sync.state === "done" && <div className={MUTED}>{`${sync.conversations ?? 0} hội thoại, ${sync.messages ?? 0} tin nhắn`}</div>}
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          {busy ? (
            <Button variant="outline" onClick={() => run("DELETE")}>
              Dừng đồng bộ
            </Button>
          ) : (
            <Button onClick={() => run("POST")}>{sync?.state === "error" ? "Thử lại" : "Đồng bộ ngay"}</Button>
          )}
        </div>
      </div>
    </Section>
  );
}
