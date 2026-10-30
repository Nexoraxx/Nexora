import type { FriendRequest, SentRequest } from "@/shared/types";
import { SECTION, ROW, MUTED } from "@/app/contact/constants/contact.constants";
import { ProfileButton } from "@/app/contact/components/list/profile-button";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { actions } from "@/app/contact/utils/contact.utils";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

export function Requests({
  requests,
  sent,
  online,
  run,
  onProfile,
}: {
  requests: FriendRequest[];
  sent: SentRequest[];
  online: boolean;
  run: (path: string, method: string, body?: unknown) => void;
  onProfile: (userId: string) => void;
}) {
  const received = requests.filter((r) => r.friendRequestType === 2);
  const suggestions = requests.filter((r) => r.friendRequestType === 1);
  return (
    <>
      <div className={SECTION}>Lời mời đã nhận ({received.length})</div>
      {received.map((r) => (
        <div key={r.userId} className={ROW}>
          <ProfileButton userId={r.userId} onProfile={onProfile}>
            <Avatar src={r.avatar} name={r.displayName} size={44} />
          </ProfileButton>
          <div className="min-w-0 flex-1">
            <div>
              {r.displayName} {!r.friendRequestRead && <Badge className="bg-blue-100 text-blue-700">Mới</Badge>}
            </div>
            {r.friendRequestMsg && <div className={MUTED}>“{r.friendRequestMsg}”</div>}
            {r.friendRequestFetchTime && <div className={MUTED}>{new Date(r.friendRequestFetchTime).toLocaleString("vi")}</div>}
          </div>
          {online && (
            <div className={actions(true)}>
              <Button variant="outline" onClick={() => run(`/friend-requests/${r.userId}/reject`, "POST")}>
                Từ chối
              </Button>
              <Button onClick={() => run(`/friend-requests/${r.userId}/accept`, "POST")}>Đồng ý</Button>
            </div>
          )}
        </div>
      ))}

      <div className={SECTION}>Lời mời đã gửi {online ? `(${sent.length})` : "— cần kết nối"}</div>
      {online &&
        sent.map((r) => (
          <div key={r.userId} className={ROW}>
            <ProfileButton userId={r.userId} onProfile={onProfile}>
              <Avatar src={r.avatar} name={r.displayName} size={44} />
            </ProfileButton>
            <div className="min-w-0 flex-1">
              <div>{r.displayName}</div>
              {r.fReqInfo?.message && <div className={MUTED}>“{r.fReqInfo.message}”</div>}
            </div>
            <div className={actions(true)}>
              <Button variant="outline" onClick={() => run(`/friend-requests/sent/${r.userId}`, "DELETE")}>
                Thu hồi
              </Button>
            </div>
          </div>
        ))}

      <div className={SECTION}>Gợi ý kết bạn ({suggestions.length})</div>
      {suggestions.map((r) => (
        <div key={r.userId} className={ROW}>
          <ProfileButton userId={r.userId} onProfile={onProfile}>
            <Avatar src={r.avatar} name={r.displayName} size={44} />
          </ProfileButton>
          <div className="min-w-0 flex-1">{r.displayName}</div>
          {online && (
            <div className={actions(true)}>
              <Button onClick={() => run("/friend-requests", "POST", { userId: r.userId, message: "Xin chào, mình kết bạn nhé!" })}>Kết bạn</Button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
