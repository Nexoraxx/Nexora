import { useState } from "react";
import { BanIcon, CameraIcon, PencilIcon, TriangleAlertIcon, UserMinusIcon, UserRoundPlusIcon, UsersIcon } from "lucide-react";
import { api } from "@/core/http/api";
import type { ChatTarget, OwnProfile, UserProfile } from "@/shared/types";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { PickGroups } from "@/app/contact/components/picker/pick-groups";
import type { Page } from "@/app/profile/models/profile.model";
import { Row } from "@/app/profile/components/info/info-row";
import { GENDER } from "@/app/profile/constants/profile.constants";
import { ActionRow } from "@/app/profile/components/info/action-row";
import { Button } from "@/shared/components/ui/button";
import { Separator } from "@/shared/components/ui/separator";
import { cn } from "@/shared/utils/shadcn";

// Zalo PC shows sdob as "DD tháng MM, YYYY" when it is a full date, anything else as is
const birthday = (sdob: string) => {
  const [d, m, y] = sdob.split("/");
  return !sdob ? "••/••/••••" : y ? `${d} tháng ${m}, ${y}` : sdob;
};
const phone = (n: string) => (n.startsWith("84") ? `+84 ${n.slice(2)}` : n);

export function Info({
  me,
  profile: p,
  accountId,
  onPage,
  run,
  onError,
  onChat,
}: {
  me: boolean;
  profile: OwnProfile | UserProfile;
  accountId: string;
  onPage: (p: Page) => void;
  run: (p: Promise<unknown>) => void;
  onError: (e: string) => void;
  onChat?: (t: ChatTarget) => void;
}) {
  const other = me ? undefined : (p as UserProfile);
  const name = other?.alias || p.displayName;
  const [showGroups, setShowGroups] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [inviting, setInviting] = useState(false);
  const base = `/accounts/${accountId}`;
  const chat = () => onChat?.({ threadId: p.userId, isGroup: false, name, avatar: p.avatar });

  return (
    <>
      <div className="h-40 bg-muted">{p.cover && <img className="size-full object-cover" src={p.cover} alt="" />}</div>
      <div className="-mt-9 flex items-end gap-3 px-4">
        <div className="relative rounded-full ring-3 ring-popover">
          <Avatar src={p.avatar} name={p.displayName} size={80} />
          {me && (
            <Button variant="secondary" size="icon-sm" className="absolute right-0 bottom-0 rounded-full ring-2 ring-popover" title="Cập nhật ảnh đại diện" onClick={() => onPage("avatar")}>
              <CameraIcon />
            </Button>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1 pb-2">
          <span className="truncate text-lg font-semibold">{name}</span>
          <Button variant="ghost" size="icon-xs" title={me ? "Cập nhật thông tin" : "Đặt tên gợi nhớ"} onClick={() => onPage(me ? "edit" : "alias")}>
            <PencilIcon />
          </Button>
        </div>
      </div>

      {other && (
        <div className="grid grid-cols-2 gap-2 px-4 pt-3">
          {other.isFr ? null : other.request === "received" ? (
            <>
              <Button variant="outline" onClick={() => run(api(`${base}/friend-requests/${p.userId}/reject`, "POST"))}>
                Từ chối
              </Button>
              <Button onClick={() => run(api(`${base}/friend-requests/${p.userId}/accept`, "POST"))}>Đồng ý</Button>
            </>
          ) : other.request === "sent" ? (
            <Button variant="outline" onClick={() => run(api(`${base}/friend-requests/sent/${p.userId}`, "DELETE"))}>
              Hủy kết bạn
            </Button>
          ) : (
            <Button variant="outline" onClick={() => run(api(`${base}/friend-requests`, "POST", { userId: p.userId, message: "Xin chào, mình kết bạn nhé!" }))}>
              Kết bạn
            </Button>
          )}
          {onChat && (
            <Button variant={other.isFr ? "default" : "secondary"} className={cn(other.isFr && "col-span-2", other.request === "received" && "col-span-2")} onClick={chat}>
              Nhắn tin
            </Button>
          )}
        </div>
      )}

      <Separator className="mt-4" />
      <section className="flex flex-col gap-2.5 px-4 py-3">
        <h4 className="font-semibold">Thông tin cá nhân</h4>
        {/* PC v26.10.20 shows the bio without an editor; Nexora edits it in "Cập nhật thông tin cá nhân" */}
        {p.status && (
          <Row label="Bio">
            <span className="whitespace-pre-wrap">{p.status}</span>
          </Row>
        )}
        {p.gender !== null && <Row label="Giới tính">{GENDER[p.gender]}</Row>}
        <Row label="Ngày sinh">{birthday(p.sdob)}</Row>
        {p.phoneNumber && (
          <Row label="Điện thoại">
            {phone(p.phoneNumber)}
            {me && <div className="text-xs text-muted-foreground">Chỉ bạn bè có lưu số của bạn trong danh bạ máy xem được số này</div>}
          </Row>
        )}
        {me && (
          <Button variant="ghost" className="mt-1" onClick={() => onPage("edit")}>
            <PencilIcon /> Cập nhật
          </Button>
        )}
      </section>

      {other && (
        <>
          <Separator />
          <div className="flex flex-col py-2">
            <ActionRow icon={<UsersIcon />} onClick={() => setShowGroups((s) => !s)}>
              Nhóm chung ({other.mutualGroups.length})
            </ActionRow>
            {showGroups &&
              other.mutualGroups.map((g) => (
                <button
                  key={g.groupId}
                  className="flex items-center gap-3 py-1.5 pr-4 pl-12 text-left hover:bg-muted"
                  onClick={() => onChat?.({ threadId: g.groupId, isGroup: true, name: g.name, avatar: g.avatar })}
                >
                  <Avatar src={g.avatar} name={g.name} size={32} />
                  <span className="truncate">{g.name}</span>
                </button>
              ))}
            {/* PC: friends only, and not while blocked */}
            <ActionRow
              icon={<UserRoundPlusIcon />}
              onClick={() =>
                !other.isFr
                  ? onError("Cần kết bạn để thêm vào nhiều nhóm khác")
                  : other.isBlocked
                    ? onError("Cần bỏ chặn để thêm vào nhiều nhóm khác")
                    : setInviting(true)
              }
            >
              Thêm vào nhóm
            </ActionRow>
            <ActionRow icon={<TriangleAlertIcon />} onClick={() => onPage("report")}>
              Báo xấu
            </ActionRow>
            <ActionRow icon={<BanIcon />} onClick={() => run(api(`${base}/blocks/${p.userId}`, other.isBlocked ? "DELETE" : "PUT"))}>
              {other.isBlocked ? "Bỏ chặn tin nhắn và cuộc gọi" : "Chặn tin nhắn và cuộc gọi"}
            </ActionRow>
            {other.isFr && (
              <ActionRow
                icon={<UserMinusIcon />}
                className="text-destructive"
                onClick={() => {
                  if (!confirmRemove) return setConfirmRemove(true);
                  setConfirmRemove(false);
                  run(api(`${base}/friends/${p.userId}`, "DELETE"));
                }}
              >
                {confirmRemove ? "Bấm lần nữa để xóa bạn" : "Xóa khỏi danh sách bạn bè"}
              </ActionRow>
            )}
          </div>
          {inviting && (
            <PickGroups
              accountId={accountId}
              userId={p.userId}
              mutual={other.mutualGroups.map((g) => g.groupId)}
              onDone={(errors) => (setInviting(false), run(Promise.resolve()), errors.length && onError(errors.join("\n")))}
              onClose={() => setInviting(false)}
            />
          )}
        </>
      )}
    </>
  );
}
