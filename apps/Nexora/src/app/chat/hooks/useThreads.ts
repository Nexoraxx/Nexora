import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import type { ConversationSettings, Thread } from "@/shared/types";

// Every account's conversation list and settings, by account id, kept fresh from /events. Held by the app so the
// account bar can count unread and "Tất cả" can merge the lists.
export function useThreads(ids: string[]) {
  const [threads, setThreads] = useState<Record<string, Thread[]>>({});
  const [settings, setSettings] = useState<Record<string, ConversationSettings>>({});
  const key = ids.join();
  useEffect(() => {
    const load = (id: string) =>
      api<Thread[]>(`/accounts/${id}/threads`)
        .then((list) => setThreads((m) => ({ ...m, [id]: list })))
        .catch(() => {});
    const loadSettings = (id: string) =>
      api<ConversationSettings>(`/accounts/${id}/conversations`)
        .then((s) => setSettings((m) => ({ ...m, [id]: s })))
        .catch(() => {});
    ids.forEach((id) => (load(id), loadSettings(id)));
    // sync can fire many "threads" events in a row: refetch each account at most every 300ms
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const off = onEvent((e) => {
      if (e.type === "threads" && ids.includes(e.accountId) && !timers.has(e.accountId))
        timers.set(
          e.accountId,
          setTimeout(() => (timers.delete(e.accountId), load(e.accountId)), 300),
        );
      else if (e.type === "conversations" && ids.includes(e.accountId)) loadSettings(e.accountId);
    });
    return () => (off(), timers.forEach(clearTimeout));
  }, [key]);
  return { threads, settings };
}
