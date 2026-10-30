import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import type { ChatTarget, MessageRow, Thread } from "@/shared/types";
import { summary } from "@/app/chat/utils/chat.utils";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { RichText } from "@/app/chat/components/message/rich-text";
import { Button } from "@/shared/components/ui/button";

// Zalo PC's "Tin đánh dấu": starred messages of every conversation, newest star first; a row opens its message
export function Starred({ accountId, onOpen }: { accountId: string; onOpen: (t: ChatTarget) => void }) {
  const [rows, setRows] = useState<MessageRow[]>();
  const [threads, setThreads] = useState<Map<string, Thread>>(new Map());
  const [error, setError] = useState<string>();
  const base = `/accounts/${accountId}`;
  useEffect(() => {
    api<MessageRow[]>(`${base}/starred`)
      .then(setRows)
      .catch((e) => setError(e.message));
    api<Thread[]>(`${base}/threads?limit=500`)
      .then((list) => setThreads(new Map(list.map((t) => [t.threadId, t]))))
      .catch(() => {});
  }, [accountId]);

  const unstar = (m: MessageRow) =>
    api(`${base}/threads/${m.threadId}/messages/${m.msgId}/star`, "PUT", { starred: false })
      .then(() => setRows((r) => r?.filter((x) => x.msgId !== m.msgId)))
      .catch((e) => setError(e.message));

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
      <h2 className="p-4 text-base font-semibold">Tin đánh dấu</h2>
      {error && <p className="px-4 text-xs text-red-600">{error}</p>}
      <div className="flex-1 overflow-y-auto">
        {rows && !rows.length && <p className="p-4 text-center text-xs text-muted-foreground">Đánh dấu tin nhắn để có thể tìm lại một cách nhanh chóng</p>}
        {rows?.map((m) => {
          const t = threads.get(m.threadId);
          return (
            <div key={m.msgId} className="flex items-center gap-3 px-4 py-2 hover:bg-muted">
              <button
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => onOpen({ threadId: m.threadId, isGroup: !!t?.isGroup, name: t?.name ?? null, avatar: t?.avatar ?? null, msgId: m.msgId })}
              >
                <Avatar src={t?.avatar} name={t?.name ?? "?"} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <b className="truncate">{t?.name ?? m.threadId}</b>
                    <span className="shrink-0 text-xs text-muted-foreground">{new Date(m.sendDttm).toLocaleDateString("vi")}</span>
                  </div>
                  <div className="truncate text-[13px] text-muted-foreground">
                    {m.fromUid === accountId ? "Bạn: " : m.dName ? `${m.dName}: ` : ""}
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
