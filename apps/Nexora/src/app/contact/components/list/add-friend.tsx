import { useState } from "react";
import { api } from "@/core/http/api";
import type { FoundUser } from "@/shared/types";
import { MUTED, ROW } from "@/app/contact/constants/contact.constants";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

// Zalo PC's global search takes digits, spaces and ) + . - as a phone number; anything else is a username here
const isPhone = (q: string) => /^[0-9) (+.-]+$/.test(q.trim());

export function AddFriend({ base, run }: { base: string; run: (path: string, method: string, body?: unknown) => Promise<unknown> }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundUser | null>();
  const [message, setMessage] = useState("Xin chào, mình kết bạn nhé!");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          setSent(false);
          setError(undefined);
          api<FoundUser | null>(`${base}/users/find?${isPhone(query) ? "phone" : "username"}=${encodeURIComponent(query.trim())}`)
            .then(setFound)
            .catch((e) => setError(e.message));
        }}
      >
        <Input placeholder="Thêm bạn bằng số điện thoại hoặc username" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button disabled={!query.trim()}>Tìm</Button>
      </form>
      {error && <div className={MUTED}>{error}</div>}
      {found === null && <div className={MUTED}>Không tìm thấy tài khoản Zalo với {isPhone(query) ? "số" : "username"} này.</div>}
      {found && (
        <div className={ROW}>
          <Avatar src={found.avatar} name={found.displayName} size={44} />
          <div className="min-w-0 flex-1">{found.displayName}</div>
          {found.isFr ? (
            <span className={MUTED}>Đã là bạn bè</span>
          ) : sent ? (
            <span className={MUTED}>Đã gửi lời mời</span>
          ) : (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                run("/friend-requests", "POST", { userId: found.userId, message }).then(() => setSent(true));
              }}
            >
              <Input value={message} onChange={(e) => setMessage(e.target.value)} />
              <Button>Kết bạn</Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
