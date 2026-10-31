import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/core/http/api";
import type { Account, ChatTarget, MessageRow, Thread } from "@/shared/types";
import { summary } from "@/app/chat/utils/chat.utils";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { RichText } from "@/app/chat/components/message/rich-text";
import { ErrorBanner } from "@/shared/components/error-banner";
import { Button } from "@/shared/components/ui/button";

type Row = MessageRow & { starredAt: number };

// Zalo PC's "Tin đánh dấu": starred messages of every conversation, newest star first; a row opens its message.
// "Tất cả" merges every account's, each row tagged with its account.
export function Starred({ accounts, tag, onOpen }: { accounts: Account[]; tag?: (accountId: string) => ReactNode; onOpen: (t: ChatTarget) => void }) {
  const [rows, setRows] = useState<Row[]>();
  // by "account:thread"
  const [threads, setThreads] = useState<Map<string, Thread>>(new Map());
  const [error, setError] = useState<string>();
  const ids = accounts.map((a) => a.id);
  useEffect(() => {
    Promise.all(ids.map((id) => api<Row[]>(`/accounts/${id}/starred`)))
      .then((lists) => setRows(lists.flat().sort((a, b) => b.starredAt - a.starredAt)))
      .catch((e) => setError(e.message));
    Promise.all(ids.map((id) => api<Thread[]>(`/accounts/${id}/threads?limit=500`).then((list) => list.map((t) => [`${id}:${t.threadId}`, t] as const))))
      .then((lists) => setThreads(new Map(lists.flat())))
      .catch(() => {});
  }, [ids.join()]);

  const unstar = (m: Row) =>
    api(`/accounts/${m.accountId}/threads/${m.threadId}/messages/${m.msgId}/star`, "PUT", { starred: false })
      .then(() => setRows((r) => r?.filter((x) => x !== m)))
      .catch((e) => setError(e.message));

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
      <h2 className="p-4 text-base font-semibold">Tin đánh dấu</h2>
      {error && <ErrorBanner className="mx-4 mb-2 rounded-lg px-3" text={error} onClose={() => setError(undefined)} />}
      <div className="flex-1 overflow-y-auto">
        {rows && !rows.length && <p className="px-6 py-10 text-center text-xs text-muted-foreground">Đánh dấu tin nhắn để có thể tìm lại một cách nhanh chóng</p>}
        {rows?.map((m) => {
          const t = threads.get(`${m.accountId}:${m.threadId}`);
          return (
            <div key={`${m.accountId}:${m.msgId}`} className="flex items-center gap-3 px-4 py-2 hover:bg-muted">
              <button
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => onOpen({ threadId: m.threadId, isGroup: !!t?.isGroup, name: t?.name ?? null, avatar: t?.avatar ?? null, msgId: m.msgId, accountId: m.accountId })}
              >
                <Avatar src={t?.avatar} name={t?.name ?? "?"} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <b className="truncate">{t?.name ?? m.threadId}</b>
                    {tag?.(m.accountId)}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{new Date(m.sendDttm).toLocaleDateString("vi")}</span>
                  </div>
                  <div className="truncate text-[13px] text-muted-foreground">
                    {m.fromUid === m.accountId ? "Bạn: " : m.dName ? `${m.dName}: ` : ""}
                    <RichText text={summary(m.msgType, m.content)} />
                  </div>
                </div>
              </button>
              <Button variant="ghost" size="xs" onClick={() => unstar(m)}>
                Bỏ đánh dấu
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
