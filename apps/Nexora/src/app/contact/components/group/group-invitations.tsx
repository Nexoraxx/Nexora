import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import type { ChatTarget, GroupInvitation } from "@/shared/types";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { MUTED } from "@/app/contact/constants/group.constants";
import { Confirm } from "@/shared/components/dialogs/confirm-dialog";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";

const expiresIn = (ts: number) => {
  const ms = ts - Date.now();
  return ms >= 86_400_000 ? `${Math.floor(ms / 86_400_000)} ngày` : ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)} giờ` : `${Math.max(1, Math.floor(ms / 60_000))} phút`;
};

// Zalo PC "Lời mời vào nhóm": groups this account was invited to and has to agree to join
export function GroupInvitations({ accountId, tick, onChat }: { accountId: string; tick: number; onChat: (t: ChatTarget) => void }) {
  const base = `/accounts/${accountId}`;
  const [list, setList] = useState<GroupInvitation[]>();
  const [declining, setDeclining] = useState<GroupInvitation>();
  const [block, setBlock] = useState(false);
  const [error, setError] = useState<string>();
  const load = () =>
    api<GroupInvitation[]>(`${base}/group-invitations`)
      .then(setList)
      .catch((e) => setError(e.message));
  useEffect(() => void load(), [tick]);

  const join = (i: GroupInvitation) =>
    api(`${base}/group-invitations/${i.groupId}/join`, "POST")
      .then(() => onChat({ threadId: i.groupId, isGroup: true, name: i.name, avatar: i.avatar }))
      .catch((e) => (setError(e.message), load()));

  return (
    <>
      {error && (
        <div className="cursor-pointer py-2 text-xs text-red-600" onClick={() => setError(undefined)}>
          {error}
        </div>
      )}
      <div className="pt-3.5 pb-1 font-semibold">Lời mời đã nhận ({list?.length ?? 0})</div>
      {list && !list.length && <p className={MUTED}>Không còn lời mời vào nhóm</p>}
      {list?.map((i) => (
        <div key={i.groupId} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted">
          <Avatar src={i.avatar} name={i.name} size={44} />
          <div className="min-w-0 flex-1">
            <div className="truncate">{i.name}</div>
            <div className={MUTED}>
              {i.inviterName} đã mời bạn tham gia nhóm · {i.totalMember} thành viên
            </div>
            {i.expiredTs > 0 && <div className={MUTED}>Hết hạn sau {expiresIn(i.expiredTs)}</div>}
          </div>
          <div className="flex gap-1.5">
            <Button variant="outline" onClick={() => (setBlock(false), setDeclining(i))}>
              Từ chối
            </Button>
            <Button onClick={() => join(i)}>Tham gia</Button>
          </div>
        </div>
      ))}
      {declining && (
        <Confirm
          ask={{
            title: "Từ chối lời mời vào nhóm?",
            message: (
              <>
                Nếu thấy phiền, bạn cũng có thể chặn người mời và nhóm này.
                <label className="mt-3 flex items-center gap-2 text-foreground">
                  <Checkbox checked={block} onCheckedChange={(v) => setBlock(v === true)} /> Chặn tất cả lời mời tham gia nhóm này
                </label>
              </>
            ),
            ok: "Từ chối",
            run: () => api(`${base}/group-invitations/${declining.groupId}?block=${block}`, "DELETE").then(load),
          }}
          onClose={() => setDeclining(undefined)}
        />
      )}
    </>
  );
}
