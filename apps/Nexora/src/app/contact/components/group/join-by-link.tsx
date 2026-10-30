import { useState } from "react";
import { api } from "@/core/http/api";
import type { ChatTarget, LinkGroup } from "@/shared/types";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { MUTED } from "@/app/contact/constants/group.constants";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

// join with a zalo.me/g/... link: the group shows first; groups with approval on take a request instead
export function JoinByLink({ accountId, onChat }: { accountId: string; onChat: (t: ChatTarget) => void }) {
  const base = `/accounts/${accountId}`;
  const [link, setLink] = useState("");
  const [found, setFound] = useState<LinkGroup>();
  const [error, setError] = useState<string>();
  const open = (g: LinkGroup) => onChat({ threadId: g.groupId, isGroup: true, name: g.name, avatar: g.avatar });
  const join = (g: LinkGroup) =>
    api(`${base}/group-links/join`, "POST", { link: link.trim() })
      .then(() => open(g))
      .catch((e) => setError(e.message));

  return (
    <div className="border-b py-2">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          setError(undefined);
          setFound(undefined);
          api<LinkGroup>(`${base}/group-links?link=${encodeURIComponent(link.trim())}`)
            .then(setFound)
            .catch((e) => setError(e.message));
        }}
      >
        <Input placeholder="Tham gia nhóm bằng link zalo.me/g/…" value={link} onChange={(e) => setLink(e.target.value)} />
        <Button disabled={!link.trim()}>Tìm</Button>
      </form>
      {error && <div className={MUTED}>{error}</div>}
      {found && (
        <div className="flex items-center gap-3 rounded-lg p-2">
          <Avatar src={found.avatar} name={found.name} size={44} />
          <div className="min-w-0 flex-1">
            <div className="truncate">{found.name}</div>
            <div className={MUTED}>{found.totalMember} thành viên</div>
          </div>
          {found.isMember ? <Button onClick={() => open(found)}>Nhắn tin</Button> : <Button onClick={() => join(found)}>Tham gia</Button>}
        </div>
      )}
    </div>
  );
}
