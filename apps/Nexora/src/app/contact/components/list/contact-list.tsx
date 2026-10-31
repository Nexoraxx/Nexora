import { useMemo, useState, type ReactNode } from "react";
import { EllipsisIcon } from "lucide-react";
import { fold } from "@/shared/utils/text.utils";
import type { ChatTarget, Friend, Group } from "@/shared/types";
import type { Ask } from "@/shared/models/dialog.model";
import { collator, MUTED, ROW } from "@/app/contact/constants/contact.constants";
import { ProfileButton } from "@/app/contact/components/list/profile-button";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { actions } from "@/app/contact/utils/contact.utils";
import { Confirm } from "@/shared/components/dialogs/confirm-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils/shadcn";

// a friend or a group of one of the shown accounts, in one A-Z list
export type Entry = (Friend & { kind: "friend"; accountId: string }) | (Group & { kind: "group"; accountId: string });

const nameOf = (e: Entry) => (e.kind === "friend" ? e.alias || e.displayName : e.displayName);
const keyOf = (e: Entry) => `${e.kind}:${e.accountId}:${e.userId}`;
const target = (e: Entry): ChatTarget => ({ threadId: e.userId, isGroup: e.kind === "group", name: nameOf(e), avatar: e.avatar, accountId: e.accountId });

// The name opens the conversation; on hover "Nhắn tin" and, for friends, a "⋯" menu with the rest
export function ContactList({
  entries,
  active,
  tag,
  run,
  onChat,
  onProfile,
}: {
  entries: Entry[];
  // "account:user" of friends online now
  active: Set<string>;
  tag?: (accountId: string) => ReactNode;
  run: (accountId: string, path: string, method: string, body?: unknown) => Promise<unknown>;
  onChat: (t: ChatTarget) => void;
  onProfile: (userId: string, accountId: string) => void;
}) {
  const [editing, setEditing] = useState<{ key: string; alias: string }>();
  const [ask, setAsk] = useState<Ask>();
  const sections = useMemo(() => {
    const byLetter = new Map<string, Entry[]>();
    for (const e of [...entries].sort((a, b) => collator.compare(nameOf(a), nameOf(b)))) {
      const letter = fold(nameOf(e))[0]?.toUpperCase() ?? "#";
      const key = /[A-Z]/.test(letter) ? letter : "#";
      byLetter.set(key, [...(byLetter.get(key) ?? []), e]);
    }
    return [...byLetter];
  }, [entries]);

  return (
    <>
      {sections.map(([letter, list]) => (
        <div key={letter}>
          <div className="px-2 pt-3 pb-1 text-xs font-semibold text-muted-foreground">{letter}</div>
          {list.map((e) => {
            const key = keyOf(e);
            const friend = e.kind === "friend" ? e : undefined;
            return (
              <div key={key} className={ROW}>
                {friend ? (
                  <ProfileButton userId={e.userId} onProfile={(uid) => onProfile(uid, e.accountId)}>
                    <Avatar src={e.avatar} name={nameOf(e)} size={40} />
                    {active.has(`${e.accountId}:${e.userId}`) && (
                      <span className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-background bg-green-500" title="Đang hoạt động" />
                    )}
                  </ProfileButton>
                ) : (
                  <Avatar src={e.avatar} name={nameOf(e)} size={40} />
                )}
                {friend && editing?.key === key ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1.5"
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      run(e.accountId, `/friends/${e.userId}/alias`, "PUT", { alias: editing.alias });
                      setEditing(undefined);
                    }}
                  >
                    <Input autoFocus value={editing.alias} placeholder={friend.displayName} onChange={(ev) => setEditing({ key, alias: ev.target.value })} />
                    <Button>Lưu</Button>
                    <Button type="button" variant="ghost" onClick={() => setEditing(undefined)}>
                      Hủy
                    </Button>
                  </form>
                ) : (
                  <button className="min-w-0 flex-1 text-left" title="Mở trò chuyện" onClick={() => onChat(target(e))}>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{nameOf(e)}</span>
                      {!!friend?.isBlocked && <Badge variant="destructive">Đã chặn</Badge>}
                      {tag?.(e.accountId)}
                    </div>
                    {friend?.alias && <div className={cn(MUTED, "truncate")}>{friend.displayName}</div>}
                    {e.kind === "group" && <div className={MUTED}>{e.totalMember} thành viên</div>}
                  </button>
                )}
                {editing?.key !== key && (
                  // stays shown while its menu is open
                  <div className={cn(actions(), "items-center has-data-[state=open]:visible")}>
                    <Button size="sm" variant="outline" onClick={() => onChat(target(e))}>
                      Nhắn tin
                    </Button>
                    {friend && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" title="Thêm">
                            <EllipsisIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onSelect={() => setEditing({ key, alias: friend.alias ?? "" })}>Đặt tên gợi nhớ</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => run(e.accountId, `/blocks/${e.userId}`, friend.isBlocked ? "DELETE" : "PUT")}>
                            {friend.isBlocked ? "Bỏ chặn" : "Chặn"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() =>
                              setAsk({
                                title: "Xóa bạn",
                                message: `Xóa ${nameOf(e)} khỏi danh sách bạn bè?`,
                                ok: "Xóa",
                                run: () => run(e.accountId, `/friends/${e.userId}`, "DELETE"),
                              })
                            }
                          >
                            Xóa bạn
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {ask && <Confirm ask={ask} onClose={() => setAsk(undefined)} />}
    </>
  );
}
