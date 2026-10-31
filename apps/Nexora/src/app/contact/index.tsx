import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRightIcon, LinkIcon, PlusIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { fold } from "@/shared/utils/text.utils";
import { api } from "@/core/http/api";
import type { Account, ChatTarget, MyCloud, Friend, FriendRequest, Group, GroupInvitation, SentRequest } from "@/shared/types";
import { CreateGroup } from "@/app/contact/components/group/create-group";
import { GroupInvitations } from "@/app/contact/components/group/group-invitations";
import { JoinByLink } from "@/app/contact/components/group/join-by-link";
import { AddFriend } from "@/app/contact/components/list/add-friend";
import { ContactList, type Entry } from "@/app/contact/components/list/contact-list";
import { ProfileButton } from "@/app/contact/components/list/profile-button";
import { Requests } from "@/app/contact/components/list/friend-requests";
import { MUTED, ROW, SECTION } from "@/app/contact/constants/contact.constants";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { ErrorBanner } from "@/shared/components/error-banner";
import { SearchInput } from "@/shared/components/search-input";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/utils/shadcn";

type Filter = "all" | "friends" | "groups";
// each list is kept per account id
type By<T> = Record<string, T>;
// Zalo's recommType of a received request (1 is a suggestion)
const RECEIVED = 2;
// pending requests shown above the list; the rest wait under "Xem tất cả"
const STRIP_MAX = 3;

// Zalo PC's "Danh bạ" as one list: friends and groups A-Z with a search and three filters; pending invitations sit
// above it only while there are some; adding a friend or a group lives under "+ Thêm". On "Tất cả" every account's
// rows are merged, tagged with their account and acted on as that account.
export function Contacts({
  accounts,
  tag,
  tick,
  onChat,
  onProfile,
}: {
  accounts: Account[];
  tag?: (accountId: string) => ReactNode;
  // bumped per account on "contacts" events
  tick: By<number>;
  onChat: (t: ChatTarget) => void;
  onProfile: (userId: string, accountId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [friends, setFriends] = useState<By<Friend[]>>({});
  const [groups, setGroups] = useState<By<Group[]>>({});
  const [requests, setRequests] = useState<By<FriendRequest[]>>({});
  const [sent, setSent] = useState<By<SentRequest[]>>({});
  const [invites, setInvites] = useState<By<GroupInvitation[]>>({});
  // friends online now (Zalo PC's green dot)
  const [active, setActive] = useState<By<string[]>>({});
  const [cloud, setCloud] = useState<By<MyCloud>>({});
  const [search, setSearch] = useState("");
  // "+ Thêm" dialogs, and the full "Lời mời" list
  const [adding, setAdding] = useState<"friend" | "group" | "link">();
  const [inbox, setInbox] = useState(false);
  // "Tất cả": the account adding a friend, creating or joining a group
  const [actor, setActor] = useState<string>();
  const [error, setError] = useState<string>();
  const fail = (e: Error) => setError(e.message);

  const ids = accounts.map((a) => a.id);
  const online = accounts.filter((a) => a.status === "online").map((a) => a.id);
  const isOnline = (id: string) => online.includes(id);
  const actorId = actor && isOnline(actor) ? actor : online[0];
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  const load = (id: string) => {
    const base = `/accounts/${id}`;
    const put =
      <T,>(set: (f: (m: By<T>) => By<T>) => void) =>
      (v: T) =>
        set((m) => ({ ...m, [id]: v }));
    api<Friend[]>(`${base}/friends`).then(put(setFriends)).catch(fail);
    api<Group[]>(`${base}/groups`).then(put(setGroups)).catch(fail);
    api<FriendRequest[]>(`${base}/friend-requests`).then(put(setRequests)).catch(fail);
    if (!isOnline(id)) return;
    api<string[]>(`${base}/friends/online`).then(put(setActive)).catch(() => {});
    api<MyCloud>(`${base}/cloud`).then(put(setCloud)).catch(() => {});
    api<GroupInvitation[]>(`${base}/group-invitations`).then(put(setInvites)).catch(() => {});
    if (inbox) api<SentRequest[]>(`${base}/friend-requests/sent`).then(put(setSent)).catch(fail);
  };
  useEffect(() => ids.forEach(load), [ids.join(), online.join(), inbox]);
  // a "contacts" event refetches only the account it came from
  const ticked = useRef(tick);
  useEffect(() => {
    for (const id of ids) if ((tick[id] ?? 0) !== (ticked.current[id] ?? 0)) load(id);
    ticked.current = tick;
  }, [ids.map((id) => tick[id] ?? 0).join()]);
  // PC marks received requests seen once their list is open; this list keeps its "Mới" marks until it closes
  useEffect(() => {
    if (inbox) online.forEach((id) => api(`/accounts/${id}/friend-requests/seen`, "POST").catch(() => {}));
  }, [inbox]);

  // every action refetches its account; the server also pushes a "contacts" event
  const run = (id: string, path: string, method: string, body?: unknown) =>
    api(`/accounts/${id}${path}`, method, body)
      .then(() => load(id))
      .catch(fail);

  // every shown account's rows, tagged with their account
  const merged = <T,>(by: By<T[]>, of = ids) => of.flatMap((id) => (by[id] ?? []).map((x) => ({ ...x, accountId: id })));
  const q = fold(search.trim());
  const allFriends = merged(friends);
  const allGroups = merged(groups);
  const entries: Entry[] = [
    ...(filter !== "groups" ? allFriends.map((f) => ({ ...f, kind: "friend" as const })) : []),
    ...(filter !== "friends" ? allGroups.map((g) => ({ ...g, kind: "group" as const })) : []),
  ].filter((e) => fold(e.kind === "friend" ? `${e.alias ?? ""} ${e.displayName}` : e.displayName).includes(q));
  const allRequests = merged(requests);
  const received = allRequests.filter((r) => r.friendRequestType === RECEIVED);
  const unseen = received.filter((r) => !r.friendRequestRead).length;
  const groupInvites = online.reduce((n, id) => n + (invites[id]?.length ?? 0), 0);
  const clouds = filter !== "groups" ? online.filter((id) => cloud[id]?.threadId && fold(cloud[id].name).includes(q)) : [];
  const loaded = ids.some((id) => friends[id]);
  // closing refetches (the effect on `inbox`), so the badge drops the requests just seen
  const closeInbox = () => setInbox(false);

  const chip = (key: Filter, label: string, count?: number) => (
    <button
      className={cn(
        "rounded-full border px-3 py-1 text-[13px] transition-colors",
        filter === key ? "border-primary/30 bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      onClick={() => setFilter(key)}
    >
      {label}
      {count !== undefined && <span className="ml-1 opacity-70">{count}</span>}
    </button>
  );

  return (
    <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        <SearchInput placeholder="Tìm bạn bè, nhóm" value={search} onChange={(e) => setSearch(e.target.value)} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={!actorId} title={actorId ? undefined : "Cần kết nối"}>
              <PlusIcon /> Thêm
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {online.length > 1 && (
              <>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Dùng tài khoản</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={actorId} onValueChange={setActor}>
                  {online.map((id) => (
                    <DropdownMenuRadioItem key={id} value={id} onSelect={(e) => e.preventDefault()}>
                      <span className="truncate">{name(id)}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={() => setAdding("friend")}>
              <UserPlusIcon /> Thêm bạn
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAdding("group")}>
              <UsersIcon /> Tạo nhóm
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAdding("link")}>
              <LinkIcon /> Vào nhóm bằng link
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-1">
        {chip("all", "Tất cả")}
        {chip("friends", "Bạn bè", allFriends.length)}
        {chip("groups", "Nhóm", allGroups.length)}
        <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => setInbox(true)}>
          Lời mời
          {unseen > 0 && <Badge className="bg-red-500 text-white">{unseen}</Badge>}
        </Button>
      </div>
      {error && <ErrorBanner className="mx-4 mt-1 rounded-lg px-3" text={error} onClose={() => setError(undefined)} />}

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {/* only while something waits; accepted or refused here, the rest under "Xem tất cả" */}
        {!q && (received.length > 0 || groupInvites > 0) && (
          <div className="mx-2 mt-2 rounded-xl border bg-muted/40 p-1">
            <div className="flex items-center px-2 py-1">
              <span className="font-medium">Lời mời đang chờ ({received.length + groupInvites})</span>
              <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => setInbox(true)}>
                Xem tất cả <ChevronRightIcon />
              </Button>
            </div>
            {received.slice(0, STRIP_MAX).map((r) => (
              <div key={`${r.accountId}:${r.userId}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                <ProfileButton userId={r.userId} onProfile={(uid) => onProfile(uid, r.accountId)}>
                  <Avatar src={r.avatar} name={r.displayName} size={32} />
                </ProfileButton>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{r.displayName}</span>
                    {tag?.(r.accountId)}
                  </div>
                  <div className={cn(MUTED, "truncate")}>{r.friendRequestMsg ? `“${r.friendRequestMsg}”` : "Muốn kết bạn"}</div>
                </div>
                {isOnline(r.accountId) && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => run(r.accountId, `/friend-requests/${r.userId}/reject`, "POST")}>
                      Từ chối
                    </Button>
                    <Button size="sm" onClick={() => run(r.accountId, `/friend-requests/${r.userId}/accept`, "POST")}>
                      Đồng ý
                    </Button>
                  </>
                )}
              </div>
            ))}
            {groupInvites > 0 && (
              <button className="w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-muted" onClick={() => setInbox(true)}>
                {groupInvites} lời mời vào nhóm
              </button>
            )}
          </div>
        )}

        {clouds.map((id) => (
          <button
            key={id}
            className={cn(ROW, "mt-2 w-full text-left")}
            onClick={() => onChat({ threadId: cloud[id].threadId!, isGroup: false, name: cloud[id].name, avatar: null, accountId: id })}
          >
            <Avatar name={cloud[id].name} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {cloud[id].name} {tag?.(id)}
              </div>
              <div className={MUTED}>Lưu và đồng bộ dữ liệu giữa các thiết bị</div>
            </div>
          </button>
        ))}

        <ContactList
          entries={entries}
          active={new Set(ids.flatMap((id) => (active[id] ?? []).map((u) => `${id}:${u}`)))}
          tag={tag}
          run={run}
          onChat={onChat}
          onProfile={onProfile}
        />
        {!entries.length && (
          <p className="px-6 py-10 text-center text-xs text-muted-foreground">
            {!loaded ? "Đang tải danh bạ…" : q ? "Không tìm thấy bạn bè hay nhóm nào khớp" : filter === "groups" ? "Chưa tham gia nhóm nào" : "Chưa có bạn bè. Bấm + Thêm để kết bạn."}
          </p>
        )}
      </div>

      {inbox && (
        <Dialog open onOpenChange={(open) => !open && closeInbox()}>
          <DialogContent aria-describedby={undefined} className="flex max-h-[85vh] w-[640px] max-w-[95vw] flex-col gap-0 p-0 sm:max-w-[640px]">
            <DialogTitle className="border-b px-5 py-4">Lời mời</DialogTitle>
            <div className="overflow-y-auto px-5 pb-5">
              <Requests requests={allRequests} sent={merged(sent, online)} online={isOnline} connected={online.length > 0} tag={tag} run={run} onProfile={onProfile} />
              <div className={cn(SECTION, "mt-2 border-t pt-4")}>Lời mời vào nhóm</div>
              {online.length ? (
                online.map((id) => (
                  <div key={id}>
                    {tag && <div className="pt-2">{tag(id)}</div>}
                    <GroupInvitations accountId={id} tick={tick[id] ?? 0} onChat={(t) => (closeInbox(), onChat({ ...t, accountId: id }))} />
                  </div>
                ))
              ) : (
                <p className={cn(MUTED, "py-2")}>Cần kết nối</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {actorId && (adding === "friend" || adding === "link") && (
        <Dialog open onOpenChange={(open) => !open && setAdding(undefined)}>
          <DialogContent aria-describedby={undefined} className="w-[520px] max-w-[95vw] sm:max-w-[520px]">
            <DialogTitle>{adding === "friend" ? "Thêm bạn" : "Vào nhóm bằng link"}</DialogTitle>
            {online.length > 1 && <p className={MUTED}>Bằng tài khoản {name(actorId)}</p>}
            {adding === "friend" ? (
              <AddFriend key={actorId} base={`/accounts/${actorId}`} run={(path, method, body) => run(actorId, path, method, body)} />
            ) : (
              <JoinByLink key={actorId} accountId={actorId} onChat={(t) => (setAdding(undefined), onChat({ ...t, accountId: actorId }))} />
            )}
          </DialogContent>
        </Dialog>
      )}
      {actorId && adding === "group" && (
        <CreateGroup accountId={actorId} onCreated={(t) => (setAdding(undefined), onChat({ ...t, accountId: actorId }))} onClose={() => setAdding(undefined)} />
      )}
    </section>
  );
}
