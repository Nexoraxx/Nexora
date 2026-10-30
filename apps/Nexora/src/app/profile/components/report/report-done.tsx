import { useState } from "react";
import { api } from "@/core/http/api";
import { openExternal } from "@/core/tauri/native";
import type { UserProfile } from "@/shared/types";
import { Confirm } from "@/shared/components/dialogs/confirm-dialog";
import type { Ask } from "@/shared/models/dialog.model";
import { Button } from "@/shared/components/ui/button";

const TERMS = "https://zalo.me/zalo/dieukhoan/";

// PC's "Đã báo xấu tài khoản": block, remove (friends only, as when the screen opened), done
export function ReportDone({ accountId, user, name, onDone }: { accountId: string; user: UserProfile; name: string; onDone: () => void }) {
  const [blocked, setBlocked] = useState(user.isBlocked);
  const [removed, setRemoved] = useState(false);
  const [ask, setAsk] = useState<Ask>();
  const base = `/accounts/${accountId}`;

  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-4">
      <p className="font-semibold">Đã báo xấu tài khoản</p>
      <p className="text-muted-foreground">
        Zalo đã nhận được báo xấu của bạn về <b>{name}</b> và sẽ xử lý theo{" "}
        <button className="text-primary hover:underline" onClick={() => openExternal(TERMS)}>
          điều khoản sử dụng Zalo
        </button>
      </p>
      <Button
        variant="outline"
        disabled={blocked}
        onClick={() =>
          setAsk({
            title: `Chặn ${name}`,
            message: "Bạn và người này sẽ: không thể nhắn tin và gọi điện cho nhau, vẫn tìm được tài khoản của nhau.",
            ok: "Chặn",
            run: () => api(`${base}/blocks/${user.userId}`, "PUT").then(() => setBlocked(true)),
          })
        }
      >
        {blocked ? `Đã chặn ${name}` : `Chặn ${name}`}
      </Button>
      {user.isFr && (
        <Button
          variant="outline"
          disabled={removed}
          onClick={() =>
            setAsk({
              title: "Xác nhận",
              message: `Xoá ${name} khỏi danh sách bạn bè?`,
              ok: "Xoá",
              run: () => api(`${base}/friends/${user.userId}`, "DELETE").then(() => setRemoved(true)),
            })
          }
        >
          {removed ? `Đã xoá bạn với ${name}` : `Xoá bạn với ${name}`}
        </Button>
      )}
      <Button className="self-end" onClick={onDone}>
        Hoàn tất
      </Button>
      {ask && <Confirm ask={ask} onClose={() => setAsk(undefined)} />}
    </div>
  );
}
