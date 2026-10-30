import { useMemo, useState } from "react";
import { fold } from "@/shared/utils/text.utils";
import type { ChatTarget, Friend } from "@/shared/types";
import { collator, MUTED, SECTION, ROW } from "@/app/contact/constants/contact.constants";
import { ProfileButton } from "@/app/contact/components/list/profile-button";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { actions } from "@/app/contact/utils/contact.utils";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils/shadcn";

export function FriendList({
  friends,
  active,
  run,
  onChat,
  onProfile,
}: {
  friends: Friend[];
  active: string[];
  run: (path: string, method: string, body?: unknown) => void;
  onChat: (t: ChatTarget) => void;
  onProfile: (userId: string) => void;
}) {
  const [editing, setEditing] = useState<{ userId: string; alias: string }>();
  const [confirmRemove, setConfirmRemove] = useState<string>();
  const sections = useMemo(() => {
    const byLetter = new Map<string, Friend[]>();
    for (const f of [...friends].sort((a, b) => collator.compare(a.alias || a.displayName, b.alias || b.displayName))) {
      const letter = fold(f.alias || f.displayName)[0]?.toUpperCase() ?? "#";
      const key = /[A-Z]/.test(letter) ? letter : "#";
      byLetter.set(key, [...(byLetter.get(key) ?? []), f]);
    }
    return [...byLetter];
  }, [friends]);

  return (
    <>
      <div className={cn(MUTED, "py-2")}>{friends.length} bạn</div>
      {sections.map(([letter, list]) => (
        <div key={letter}>
          <div className={SECTION}>{letter}</div>
          {list.map((f) => (
            <div key={f.userId} className={ROW}>
              <ProfileButton userId={f.userId} onProfile={onProfile}>
                <Avatar src={f.avatar} name={f.alias || f.displayName} size={44} />
                {active.includes(f.userId) && <span className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-background bg-green-500" title="Đang hoạt động" />}
              </ProfileButton>
              <div className="min-w-0 flex-1">
                {editing?.userId === f.userId ? (
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(`/friends/${f.userId}/alias`, "PUT", { alias: editing.alias });
                      setEditing(undefined);
                    }}
                  >
                    <Input autoFocus value={editing.alias} placeholder={f.displayName} onChange={(e) => setEditing({ ...editing, alias: e.target.value })} />
                    <Button>Lưu</Button>
                    <Button type="button" variant="outline" onClick={() => setEditing(undefined)}>
                      Hủy
                    </Button>
                  </form>
                ) : (
                  <>
                    <div>
                      {f.alias || f.displayName} {!!f.isBlocked && <Badge variant="destructive">Đã chặn</Badge>}
                    </div>
                    {f.alias && <div className={MUTED}>{f.displayName}</div>}
                  </>
                )}
              </div>
              <div className={actions()}>
                <Button onClick={() => onChat({ threadId: f.userId, isGroup: false, name: f.alias || f.displayName, avatar: f.avatar })}>Nhắn tin</Button>
                <Button variant="outline" onClick={() => setEditing({ userId: f.userId, alias: f.alias ?? "" })}>
                  Tên gợi nhớ
                </Button>
                <Button variant="outline" onClick={() => run(`/blocks/${f.userId}`, f.isBlocked ? "DELETE" : "PUT")}>
                  {f.isBlocked ? "Bỏ chặn" : "Chặn"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (confirmRemove !== f.userId) return setConfirmRemove(f.userId);
                    setConfirmRemove(undefined);
                    run(`/friends/${f.userId}`, "DELETE");
                  }}
                >
                  {confirmRemove === f.userId ? "Xác nhận xóa" : "Xóa bạn"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
