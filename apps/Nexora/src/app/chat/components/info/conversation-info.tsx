import { useEffect, useState } from "react";
import {
  BellIcon,
  BellOffIcon,
  ClockIcon,
  EllipsisIcon,
  LogOutIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  TriangleAlertIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import { ttlText } from "@/app/chat/utils/chat.utils";
import type { ChatTarget, ConversationSettings, GroupDetails, GroupMember, GroupSetting, UserProfile } from "@/shared/types";
import { BoardList } from "@/app/chat/components/board/board-list";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { Confirm } from "@/shared/components/dialogs/confirm-dialog";
import { PickFriends } from "@/app/contact/components/picker/pick-friends";
import { PickGroups } from "@/app/contact/components/picker/pick-groups";
import { pickImage, uploadGroupAvatar } from "@/app/contact/utils/group.utils";
import type { Ask } from "@/shared/models/dialog.model";
import { squareJpeg } from "@/app/profile/utils/profile.utils";
import { Report } from "@/app/profile/components/report/report";
import { Toggle } from "@/app/chat/components/info/info-toggle";
import { Section } from "@/app/chat/components/info/info-section";
import { AutoDeleteDialog } from "@/app/chat/components/info/auto-delete-dialog";
import { GroupLinkSection } from "@/app/chat/components/info/group-link-section";
import { MediaSection } from "@/app/chat/components/info/media-section";
import { PendingDialog } from "@/app/chat/components/info/pending-dialog";
import { BlockedDialog } from "@/app/chat/components/info/blocked-dialog";
import { LeaveDialog } from "@/app/chat/components/info/leave-dialog";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";

// Zalo PC "Tắt thông báo" choices
const MUTE: [string, 3600 | 14400 | "until8AM" | -1][] = [
  ["Trong 1 giờ", 3600],
  ["Trong 4 giờ", 14400],
  ["Cho đến 8:00 AM", "until8AM"],
  ["Cho đến khi được mở lại", -1],
];
const ROLE = { owner: "Trưởng nhóm", admin: "Phó nhóm" };

// Zalo PC "Quản lý nhóm": "Cho phép các thành viên trong nhóm:" ticks a flag that is 0, the switches below are 1 when on
const ALLOW: [keyof GroupSetting, string][] = [
  ["blockName", "Thay đổi tên & ảnh đại diện của nhóm"],
  ["setTopicOnly", "Ghim tin nhắn, ghi chú, bình chọn lên đầu hội thoại"],
  ["lockCreatePost", "Tạo mới ghi chú, nhắc hẹn"],
  ["lockCreatePoll", "Tạo mới bình chọn"],
  ["lockSendMsg", "Gửi tin nhắn"],
];
const SWITCHES: [keyof GroupSetting, string, string?][] = [
  ["joinAppr", "Chế độ phê duyệt thành viên mới"],
  ["lockViewMember", "Chỉ trưởng/phó nhóm xem được đầy đủ danh sách thành viên"],
  ["signAdminMsg", "Đánh dấu tin nhắn từ trưởng/phó nhóm", "Khi bật, tin nhắn từ Trưởng/ phó nhóm sẽ có ký hiệu chìa khóa."],
  ["enableMsgHistory", "Cho phép thành viên mới đọc tin nhắn gần nhất", "Khi bật, thành viên mới sẽ xem được các tin nhắn trong nhóm trước khi họ tham gia."],
];

// Zalo PC's right-hand "Thông tin hội thoại" (1-1) / "Thông tin nhóm" panel: header, mute and pin, group members or
// mutual groups, then photos/videos, files and links from local history. Groups also get PC's management: members
// (deputies, owner, remove, block), approvals, join link, "Quản lý nhóm" and leaving.
export function ConversationInfo({
  accountId,
  target,
  cloud,
  settings,
  onProfile,
  onOpen,
  onClose,
  onLeft,
}: {
  accountId: string;
  target: ChatTarget;
  // "Cloud của tôi": PC shows no mute, auto-delete, alias or report for it
  cloud?: boolean;
  settings: ConversationSettings;
  onProfile: (userId: string) => void;
  onOpen: (t: ChatTarget) => void;
  onClose: () => void;
  // this account left or dispersed the group
  onLeft: () => void;
}) {
  const base = `/accounts/${accountId}`;
  const id = target.threadId;
  const [group, setGroup] = useState<GroupDetails>();
  const [user, setUser] = useState<UserProfile>();
  const [renaming, setRenaming] = useState<string>();
  const [ttlOpen, setTtlOpen] = useState(false);
  const [dialog, setDialog] = useState<"add" | "pending" | "blocked" | "leave" | "report" | "invite">();
  const [ask, setAsk] = useState<Ask>();
  const [error, setError] = useState<string>();
  const fail = (e: Error) => setError(e.message);

  const load = () =>
    (target.isGroup ? api<GroupDetails>(`${base}/groups/${id}`).then(setGroup) : cloud ? Promise.resolve() : api<UserProfile>(`${base}/users/${id}`).then(setUser)).catch(fail);
  useEffect(() => {
    load();
    // members, deputies, name or settings changed on any device
    return onEvent((e) => {
      if (e.type === "group" && e.accountId === accountId && e.groupId === id) load();
    });
  }, [id]);

  const run = (p: Promise<unknown>) => (setError(undefined), p.catch(fail));
  const muted = settings.muted[id];
  const pinned = settings.pinned.includes(id);
  const ttl = settings.ttl[id] ?? 0;
  // groups: only the owner sets it, as on PC
  const ttlLocked = target.isGroup && group?.members.find((m) => m.role === "owner")?.userId !== accountId;
  const name = group?.name ?? user?.alias ?? user?.displayName ?? target.name ?? id;
  const gbase = `${base}/groups/${id}`;
  const role = group?.members.find((m) => m.userId === accountId)?.role ?? null;
  const owner = role === "owner";
  // every change reloads the panel; Zalo's group event reloads it again
  const change = (p: Promise<unknown>) => p.then(load);
  const setFlag = (key: keyof GroupSetting, value: number) => run(change(api(`${gbase}/settings`, "PUT", { [key]: value })));
  const leave = (silent: boolean, newOwnerId?: string) => api(`${gbase}/leave`, "POST", { silent, newOwnerId }).then(onLeft);

  // Zalo PC's member menu: the owner names and drops deputies, hands the group over and removes anyone; deputies
  // remove plain members; your own row leaves
  const memberActions = (m: GroupMember): [string, () => void, boolean?][] => {
    if (m.userId === accountId) return [["Rời nhóm", () => setDialog("leave"), true]];
    const items: [string, () => void, boolean?][] = [];
    if (owner)
      items.push(
        m.role === "admin"
          ? ["Gỡ quyền phó nhóm", () => setAsk({ title: "Gỡ quyền phó nhóm", message: `Xóa quyền phó nhóm của ${m.name}?`, ok: "Gỡ quyền", run: () => change(api(`${gbase}/admins/${m.userId}`, "DELETE")) })]
          : ["Thêm phó nhóm", () => run(change(api(`${gbase}/admins/${m.userId}`, "PUT")))],
        [
          "Chuyển quyền trưởng nhóm",
          () =>
            setAsk({
              title: "Chuyển quyền trưởng nhóm",
              message: `Sau khi thay đổi ${m.name} sẽ trở thành trưởng nhóm mới và bạn sẽ trở thành một thành viên bình thường.`,
              ok: "Xác nhận",
              run: () => change(api(`${gbase}/owner`, "PUT", { userId: m.userId })),
            }),
        ],
      );
    if (owner || (role === "admin" && !m.role))
      items.push(
        ["Xóa khỏi nhóm", () => setAsk({ title: "Xóa khỏi nhóm", message: `Xoá ${m.name} khỏi nhóm?`, ok: "Xóa", run: () => change(api(`${gbase}/members/${m.userId}`, "DELETE")) }), true],
        [
          "Chặn khỏi nhóm",
          () =>
            setAsk({
              title: "Chặn thành viên",
              message: `Chặn ${m.name}? Những người đã bị chặn không thể tham gia lại nhóm, trừ khi được trưởng, phó nhóm bỏ chặn hoặc thêm lại vào nhóm.`,
              ok: "Chặn",
              run: () => change(api(`${gbase}/blocked/${m.userId}`, "PUT")),
            }),
          true,
        ],
      );
    return items;
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-background">
      <div className="relative flex h-16 shrink-0 items-center justify-center border-b font-semibold">
        {target.isGroup ? "Thông tin nhóm" : "Thông tin hội thoại"}
        <Button variant="ghost" size="icon-sm" className="absolute right-2" title="Đóng" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="cursor-pointer bg-red-50 px-4 py-2 whitespace-pre-line text-red-700" onClick={() => setError(undefined)}>
            {error}
          </div>
        )}
        <div className="flex flex-col items-center gap-2 px-4 pt-4 pb-3">
          <button
            disabled={target.isGroup && !group?.canEdit}
            title={target.isGroup ? "Cập nhật ảnh đại diện" : undefined}
            onClick={() =>
              target.isGroup ? pickImage((f) => run(squareJpeg(f).then((img) => change(uploadGroupAvatar(accountId, id, img))))) : onProfile(id)
            }
          >
            <Avatar src={group?.avatar ?? user?.avatar ?? target.avatar} name={name} size={56} />
          </button>
          {renaming !== undefined ? (
            <form
              className="flex w-full gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                run(api(`${base}/groups/${id}/name`, "PUT", { name: renaming }).then(() => (setRenaming(undefined), load())));
              }}
            >
              <Input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} />
              <Button disabled={!renaming.trim()}>Lưu</Button>
              <Button type="button" variant="outline" onClick={() => setRenaming(undefined)}>
                Hủy
              </Button>
            </form>
          ) : (
            <div className="flex max-w-full items-center gap-1">
              <span className="truncate text-base font-semibold">{name}</span>
              {(target.isGroup ? group?.canEdit : !cloud) && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title={target.isGroup ? "Đổi tên nhóm" : "Đặt tên gợi nhớ"}
                  onClick={() => (target.isGroup ? setRenaming(name) : onProfile(id))}
                >
                  <PencilIcon />
                </Button>
              )}
            </div>
          )}
          <div className="flex gap-6 pt-1">
            {cloud ? null : muted !== undefined ? (
              <Toggle icon={<BellOffIcon />} active onClick={() => run(api(`${base}/conversations/${id}/mute`, "PUT", { isGroup: target.isGroup, duration: null }))}>
                Bật thông báo
              </Toggle>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Toggle icon={<BellIcon />}>Tắt thông báo</Toggle>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-52">
                  {MUTE.map(([label, duration]) => (
                    <DropdownMenuItem key={label} onSelect={() => run(api(`${base}/conversations/${id}/mute`, "PUT", { isGroup: target.isGroup, duration }))}>
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Toggle
              icon={pinned ? <PinOffIcon /> : <PinIcon />}
              active={pinned}
              onClick={() => run(api(`${base}/conversations/${id}/pin`, "PUT", { isGroup: target.isGroup, pinned: !pinned }))}
            >
              {pinned ? "Bỏ ghim hội thoại" : "Ghim hội thoại"}
            </Toggle>
            {group && (
              <Toggle icon={<UserPlusIcon />} onClick={() => setDialog("add")}>
                Thêm thành viên
              </Toggle>
            )}
          </div>
          {muted !== undefined && muted !== -1 && (
            <p className="text-xs text-muted-foreground">Tắt thông báo đến {new Date(muted).toLocaleString("vi", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</p>
          )}
        </div>

        {!cloud && (
          <Section title="Thiết lập bảo mật">
            <button
              className="flex w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-muted disabled:opacity-60"
              disabled={ttlLocked}
              title={ttlLocked ? "Chỉ dành cho trưởng nhóm" : "Tin nhắn sẽ tự xóa sau khoảng thời gian bạn cài đặt"}
              onClick={() => setTtlOpen(true)}
            >
              <ClockIcon className="size-5 text-muted-foreground" />
              <div>
                <div>Tin nhắn tự xóa</div>
                <div className="text-xs text-muted-foreground">{ttl ? ttlText(ttl) : "Không bao giờ"}</div>
              </div>
            </button>
          </Section>
        )}
        {ttlOpen && (
          <AutoDeleteDialog
            current={ttl}
            onSave={(next) => run(api(`${base}/conversations/${id}/auto-delete`, "PUT", { isGroup: target.isGroup, ttl: next }).then(() => setTtlOpen(false)))}
            onClose={() => setTtlOpen(false)}
          />
        )}

        {group && (
          <Section title="Thành viên nhóm" count={`${group.totalMember} thành viên`}>
            {group.desc && <p className="px-4 pb-2 whitespace-pre-wrap text-muted-foreground">{group.desc}</p>}
            {group.locked && <p className="px-4 pb-2 text-xs text-muted-foreground">Chỉ trưởng/phó nhóm xem được đầy đủ danh sách thành viên.</p>}
            {group.pending > 0 && (
              <button className="w-full px-4 py-1.5 text-left text-primary hover:bg-muted" onClick={() => setDialog("pending")}>
                Danh sách cần phê duyệt: {group.pending} thành viên
              </button>
            )}
            {group.members.map((m) => {
              const actions = memberActions(m);
              return (
                <div key={m.userId} className="group/row flex items-center gap-1 pr-2 hover:bg-muted">
                  <button className="flex min-w-0 flex-1 items-center gap-3 py-1.5 pl-4 text-left" onClick={() => onProfile(m.userId)}>
                    <Avatar src={m.avatar} name={m.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{m.userId === accountId ? "Bạn" : m.name}</div>
                      {m.role && <div className="text-xs text-muted-foreground">{ROLE[m.role]}</div>}
                    </div>
                  </button>
                  {actions.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" title="Tùy chọn" className="invisible group-hover/row:visible aria-expanded:visible">
                          <EllipsisIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {actions.map(([label, act, danger]) => (
                          <DropdownMenuItem key={label} variant={danger ? "destructive" : "default"} onSelect={act}>
                            {label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
          </Section>
        )}
        {group && <GroupLinkSection base={gbase} admin={!!role} onAsk={setAsk} />}
        {group && role && (
          <Section title="Quản lý nhóm">
            <div className="px-4 pb-1 text-xs text-muted-foreground">Cho phép các thành viên trong nhóm:</div>
            {ALLOW.map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-3 px-4 py-1.5 hover:bg-muted">
                <Checkbox checked={!group.setting[key]} onCheckedChange={() => setFlag(key, group.setting[key] ? 0 : 1)} />
                {label}
              </label>
            ))}
            <div className="mx-4 my-1 border-t" />
            {SWITCHES.map(([key, label, tip]) => (
              <label key={key} className="flex cursor-pointer items-center gap-3 px-4 py-1.5 hover:bg-muted" title={tip}>
                <Checkbox checked={!!group.setting[key]} onCheckedChange={() => setFlag(key, group.setting[key] ? 0 : 1)} />
                {label}
              </label>
            ))}
            <div className="mx-4 my-1 border-t" />
            <button className="w-full px-4 py-1.5 text-left hover:bg-muted" onClick={() => setDialog("blocked")}>
              Chặn khỏi nhóm
            </button>
            {owner && (
              <button
                className="w-full px-4 py-1.5 text-left text-destructive hover:bg-muted"
                onClick={() =>
                  setAsk({
                    title: "Giải tán nhóm",
                    message: "Mời tất cả mọi người rời nhóm và xóa tin nhắn? Nhóm đã giải tán sẽ KHÔNG THỂ khôi phục.",
                    ok: "Giải tán nhóm",
                    run: () => api(gbase, "DELETE").then(onLeft),
                  })
                }
              >
                Giải tán nhóm
              </button>
            )}
          </Section>
        )}
        {user && (
          <Section title="Nhóm chung" count={`${user.mutualGroups.length} nhóm chung`}>
            {user.mutualGroups.map((g) => (
              <button
                key={g.groupId}
                className="flex w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-muted"
                onClick={() => onOpen({ threadId: g.groupId, isGroup: true, name: g.name, avatar: g.avatar })}
              >
                <Avatar src={g.avatar} name={g.name} size={36} />
                <span className="truncate">{g.name}</span>
              </button>
            ))}
            {/* PC's 1-1 panel offers it to a friend with no group in common */}
            {user.isFr && !user.mutualGroups.length && (
              <button className="flex w-full items-center gap-3 px-4 py-1.5 text-left text-primary hover:bg-muted" onClick={() => setDialog("invite")}>
                <UserPlusIcon className="size-5" /> Thêm vào nhóm
              </button>
            )}
          </Section>
        )}

        <Section title="Bảng tin">
          <BoardList accountId={accountId} threadId={id} isGroup={target.isGroup} />
        </Section>
        <MediaSection base={`${base}/threads/${id}/media`} kind="media" title="Ảnh/Video" preview={8} />
        <MediaSection base={`${base}/threads/${id}/media`} kind="file" title="File" preview={3} />
        <MediaSection base={`${base}/threads/${id}/media`} kind="link" title="Link" preview={3} />
        <section className="border-t-8 border-muted py-2">
          {(group || user) && (
            <button className="flex w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-muted" onClick={() => setDialog("report")}>
              <TriangleAlertIcon className="size-5 text-muted-foreground" /> Báo xấu
            </button>
          )}
          {group && (
            <button className="flex w-full items-center gap-3 px-4 py-1.5 text-left text-destructive hover:bg-muted" onClick={() => setDialog("leave")}>
              <LogOutIcon className="size-5" /> Rời nhóm
            </button>
          )}
        </section>
      </div>
      {ask && <Confirm ask={ask} onClose={() => setAsk(undefined)} />}
      {group && dialog === "add" && (
        <PickFriends
          accountId={accountId}
          title="Thêm thành viên vào nhóm"
          confirm="Xác nhận"
          taken={group.members.map((m) => m.userId)}
          onConfirm={(userIds) =>
            api<{ errors: string[] }>(`${gbase}/members`, "POST", { userIds }).then((r) => (setDialog(undefined), setError(r.errors.join("\n") || undefined), load()))
          }
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === "pending" && <PendingDialog base={gbase} onChanged={load} onClose={() => setDialog(undefined)} />}
      {dialog === "blocked" && <BlockedDialog base={gbase} onClose={() => setDialog(undefined)} />}
      {user && dialog === "invite" && (
        <PickGroups
          accountId={accountId}
          userId={id}
          mutual={user.mutualGroups.map((g) => g.groupId)}
          onDone={(errors) => (setDialog(undefined), setError(errors.join("\n") || undefined), load())}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === "report" && (
        <Dialog open onOpenChange={(open) => !open && setDialog(undefined)}>
          <DialogContent aria-describedby={undefined} className="w-[400px] gap-0 p-0">
            <DialogTitle className="px-4 py-3">{group ? "Báo xấu" : "Báo xấu tài khoản"}</DialogTitle>
            <Report accountId={accountId} targetId={id} name={name} user={user} onDone={() => (setDialog(undefined), load())} />
          </DialogContent>
        </Dialog>
      )}
      {group && dialog === "leave" && (
        <LeaveDialog owner={owner} members={group.members.filter((m) => m.userId !== accountId)} onLeave={leave} onClose={() => setDialog(undefined)} />
      )}
    </aside>
  );
}
