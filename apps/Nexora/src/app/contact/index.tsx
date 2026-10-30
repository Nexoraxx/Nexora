import { useEffect, useState } from "react";
import { fold } from "@/shared/utils/text.utils";
import { api } from "@/core/http/api";
import type { ChatTarget, MyCloud, Friend, FriendRequest, Group, SentRequest } from "@/shared/types";
import { CreateGroup } from "@/app/contact/components/group/create-group";
import { GroupInvitations } from "@/app/contact/components/group/group-invitations";
import { JoinByLink } from "@/app/contact/components/group/join-by-link";
import { AddFriend } from "@/app/contact/components/list/add-friend";
import { SECTION, ROW, MUTED, collator } from "@/app/contact/constants/contact.constants";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { FriendList } from "@/app/contact/components/list/friend-list";
import { actions } from "@/app/contact/utils/contact.utils";
import { Requests } from "@/app/contact/components/list/friend-requests";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/utils/shadcn";

type Tab = "friends" | "groups" | "requests" | "invitations";

export function Contacts({
  accountId,
  online,
  tick,
  onChat,
  onProfile,
}: {
  accountId: string;
  online: boolean;
  tick: number;
  onChat: (t: ChatTarget) => void;
  onProfile: (userId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("friends");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [sent, setSent] = useState<SentRequest[]>([]);
  // friends online now (Zalo PC's green dot)
  const [active, setActive] = useState<string[]>([]);
  const [cloud, setCloud] = useState<MyCloud>();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const base = `/accounts/${accountId}`;

  const load = () => {
    if (tab === "friends") api<Friend[]>(`${base}/friends`).then(setFriends).catch((e) => setError(e.message));
    if (tab === "friends" && online) api<string[]>(`${base}/friends/online`).then(setActive).catch(() => {});
    if (tab === "friends" && online) api<MyCloud>(`${base}/cloud`).then(setCloud).catch(() => {});
    if (tab === "groups") api<Group[]>(`${base}/groups`).then(setGroups).catch((e) => setError(e.message));
    // always loaded: the tab badge counts received requests
    // PC marks every received request seen while this tab is open; after the fetch, so this view keeps its "Mới" marks
    api<FriendRequest[]>(`${base}/friend-requests`)
      .then((list) => {
        setRequests(list);
        if (tab === "requests" && online) api(`${base}/friend-requests/seen`, "POST").catch(() => {});
      })
      .catch((e) => setError(e.message));
    if (tab === "requests" && online) api<SentRequest[]>(`${base}/friend-requests/sent`).then(setSent).catch((e) => setError(e.message));
  };
  useEffect(load, [tab, tick, online]);

  // every action refetches; the server also pushes a "contacts" event
  const run = (path: string, method: string, body?: unknown) =>
    api(`${base}${path}`, method, body)
      .then(load)
      .catch((e) => setError(e.message));

  const open = (t: Tab) => (setTab(t), setSearch(""));
  const q = fold(search.trim());
  // received requests not seen yet; cleared by opening the tab
  const unseen = tab === "requests" ? 0 : requests.filter((r) => r.friendRequestType === 2 && !r.friendRequestRead).length;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <Tabs value={tab} onValueChange={(t) => open(t as Tab)} className="border-b px-2">
        <TabsList variant="line" className="h-11">
          <TabsTrigger value="friends">Bạn bè</TabsTrigger>
          <TabsTrigger value="groups">Nhóm</TabsTrigger>
          <TabsTrigger value="requests">
            Lời mời kết bạn {unseen > 0 && <Badge className="bg-red-500 text-white">{unseen}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="invitations">Lời mời vào nhóm</TabsTrigger>
        </TabsList>
      </Tabs>
      {error && (
        <div className="cursor-pointer bg-red-50 px-4 py-2 text-red-700" onClick={() => setError(undefined)}>
          {error}
        </div>
      )}
      {(tab === "friends" || tab === "groups") && (
        <div className="px-4 pt-3">
          <Input placeholder="Tìm kiếm" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
        {tab === "friends" && (
          <>
            {online && <AddFriend base={base} run={run} />}
            {cloud?.threadId && (
              <>
                <div className={SECTION}>Gửi File giữa di động và máy tính</div>
                <button className={cn(ROW, "w-full text-left")} onClick={() => onChat({ threadId: cloud.threadId!, isGroup: false, name: cloud.name, avatar: null })}>
                  <Avatar name={cloud.name} size={44} />
                  <div className="min-w-0 flex-1">
                    <div>{cloud.name}</div>
                    <div className={MUTED}>Lưu và đồng bộ dữ liệu giữa các thiết bị</div>
                  </div>
                </button>
              </>
            )}
            <FriendList
              friends={friends.filter((f) => fold(`${f.alias ?? ""} ${f.displayName}`).includes(q))}
              active={active}
              run={run}
              onChat={onChat}
              onProfile={onProfile}
            />
          </>
        )}
        {tab === "groups" && online && (
          <>
            <Button className="mt-2 w-full" onClick={() => setCreating(true)}>
              Tạo nhóm
            </Button>
            <JoinByLink accountId={accountId} onChat={onChat} />
          </>
        )}
        {tab === "groups" &&
          groups
            .filter((g) => fold(g.displayName).includes(q))
            .sort((a, b) => collator.compare(a.displayName, b.displayName))
            .map((g) => (
              <div key={g.userId} className={ROW}>
                <Avatar src={g.avatar} name={g.displayName} size={44} />
                <div className="min-w-0 flex-1">
                  <div>{g.displayName}</div>
                  <div className={MUTED}>{g.totalMember} thành viên</div>
                </div>
                <div className={actions()}>
                  <Button onClick={() => onChat({ threadId: g.userId, isGroup: true, name: g.displayName, avatar: g.avatar })}>Nhắn tin</Button>
                </div>
              </div>
            ))}
        {tab === "requests" && <Requests requests={requests} sent={sent} online={online} run={run} onProfile={onProfile} />}
        {tab === "invitations" && (online ? <GroupInvitations accountId={accountId} tick={tick} onChat={onChat} /> : <p className={cn(MUTED, "py-2")}>Cần kết nối</p>)}
      </div>
      {creating && <CreateGroup accountId={accountId} onCreated={(t) => (setCreating(false), onChat(t))} onClose={() => setCreating(false)} />}
    </section>
  );
}
