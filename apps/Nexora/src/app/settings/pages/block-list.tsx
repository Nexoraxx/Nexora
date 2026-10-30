import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import type { BlockedUser } from "@/shared/types";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { MUTED } from "@/app/settings/constants/settings.constants";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils/shadcn";

// Zalo PC "Danh sách chặn": fetched on every open, "Bỏ chặn" right away; people get on it from their profile
// ("Chặn tin nhắn và cuộc gọi")
export function BlockList({ accountId, onProfile }: { accountId: string; onProfile: (userId: string) => void }) {
  const [list, setList] = useState<BlockedUser[]>();
  const [error, setError] = useState<string>();
  const base = `/accounts/${accountId}`;
  const load = () =>
    api<BlockedUser[]>(`${base}/blocks`)
      .then(setList)
      .catch((e) => (setList([]), setError(e.message)));
  useEffect(() => {
    load();
    return onEvent((e) => e.type === "contacts" && e.accountId === accountId && load());
  }, [accountId]);

  if (!list) return <p className={MUTED}>Đang tải dữ liệu</p>;
  return (
    <>
      {error && <p className="pb-2 text-xs text-red-600">{error}</p>}
      <p className={cn(MUTED, "pb-2")}>{list.length ? "Những người này không thể gửi tin nhắn cho bạn" : "Bạn chưa chặn ai"}</p>
      {list.map((u) => (
        <div key={u.userId} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted">
          <button title="Xem hồ sơ" onClick={() => onProfile(u.userId)}>
            <Avatar src={u.avatar} name={u.name} size={40} />
          </button>
          <div className="min-w-0 flex-1 truncate">{u.name}</div>
          <Button
            variant="outline"
            onClick={() =>
              api(`${base}/blocks/${u.userId}`, "DELETE")
                .then(() => setList((l) => l?.filter((x) => x.userId !== u.userId)))
                .catch((e) => setError(e.message))
            }
          >
            Bỏ chặn
          </Button>
        </div>
      ))}
    </>
  );
}
