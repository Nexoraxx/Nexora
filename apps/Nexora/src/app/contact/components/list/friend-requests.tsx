import type { ReactNode } from "react";
import type { FriendRequest, SentRequest } from "@/shared/types";
import { SECTION, ROW, MUTED } from "@/app/contact/constants/contact.constants";
import { ProfileButton } from "@/app/contact/components/list/profile-button";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { actions } from "@/app/contact/utils/contact.utils";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

// requests of the shown accounts ("Tất cả": every account's, tagged); each acts as its own account
type Of<T> = T & { accountId: string };

export function Requests({
  requests,
  sent,
  online,
  connected,
  tag,
  run,
  onProfile,
}: {
  requests: Of<FriendRequest>[];
  // of the accounts online only (Zalo is asked each time)
  sent: Of<SentRequest>[];
  online: (accountId: string) => boolean;
  // some shown account is online (sent requests are asked from Zalo)
  connected: boolean;
  tag?: (accountId: string) => ReactNode;
  run: (accountId: string, path: string, method: string, body?: unknown) => void;
  onProfile: (userId: string, accountId: string) => void;
}) {
  const received = requests.filter((r) => r.friendRequestType === 2);
  const suggestions = requests.filter((r) => r.friendRequestType === 1);
  return (
    <>
      <div className={SECTION}>Lời mời đã nhận ({received.length})</div>
      {received.map((r) => (
        <div key={`${r.accountId}:${r.userId}`} className={ROW}>
          <ProfileButton userId={r.userId} onProfile={(uid) => onProfile(uid, r.accountId)}>
            <Avatar src={r.avatar} name={r.displayName} size={44} />
          </ProfileButton>
          <div className="min-w-0 flex-1">
            <div>
              {r.displayName} {!r.friendRequestRead && <Badge className="bg-blue-100 text-blue-700">Mới</Badge>} {tag?.(r.accountId)}
            </div>
            {r.friendRequestMsg && <div className={MUTED}>“{r.friendRequestMsg}”</div>}
            {r.friendRequestFetchTime && <div className={MUTED}>{new Date(r.friendRequestFetchTime).toLocaleString("vi")}</div>}
          </div>
          {online(r.accountId) && (
            <div className={actions(true)}>
              <Button variant="outline" onClick={() => run(r.accountId, `/friend-requests/${r.userId}/reject`, "POST")}>
                Từ chối
              </Button>
              <Button onClick={() => run(r.accountId, `/friend-requests/${r.userId}/accept`, "POST")}>Đồng ý</Button>
            </div>
          )}
        </div>
      ))}

      <div className={SECTION}>Lời mời đã gửi {connected ? `(${sent.length})` : "(cần kết nối)"}</div>
      {sent.map((r) => (
          <div key={`${r.accountId}:${r.userId}`} className={ROW}>
            <ProfileButton userId={r.userId} onProfile={(uid) => onProfile(uid, r.accountId)}>
              <Avatar src={r.avatar} name={r.displayName} size={44} />
            </ProfileButton>
            <div className="min-w-0 flex-1">
              <div>
                {r.displayName} {tag?.(r.accountId)}
              </div>
              {r.fReqInfo?.message && <div className={MUTED}>“{r.fReqInfo.message}”</div>}
            </div>
            <div className={actions(true)}>
              <Button variant="outline" onClick={() => run(r.accountId, `/friend-requests/sent/${r.userId}`, "DELETE")}>
                Thu hồi
              </Button>
            </div>
          </div>
        ))}

      <div className={SECTION}>Gợi ý kết bạn ({suggestions.length})</div>
      {suggestions.map((r) => (
        <div key={`${r.accountId}:${r.userId}`} className={ROW}>
          <ProfileButton userId={r.userId} onProfile={(uid) => onProfile(uid, r.accountId)}>
            <Avatar src={r.avatar} name={r.displayName} size={44} />
          </ProfileButton>
          <div className="min-w-0 flex-1">
            {r.displayName} {tag?.(r.accountId)}
          </div>
          {online(r.accountId) && (
            <div className={actions(true)}>
              <Button onClick={() => run(r.accountId, "/friend-requests", "POST", { userId: r.userId, message: "Xin chào, mình kết bạn nhé!" })}>Kết bạn</Button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
