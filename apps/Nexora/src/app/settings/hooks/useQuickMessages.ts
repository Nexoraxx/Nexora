import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import type { QuickMessage, Settings } from "@/shared/types";

// the quick messages for the composer: loaded the first time "/" is typed, none while the feature is switched off
// ("Tin nhắn nhanh" in Cài đặt → Tin nhắn); a change here or elsewhere reloads on the next use
// null = switched off (or not loadable)
export function useQuickMessages(accountId: string, wanted: boolean) {
  const [items, setItems] = useState<QuickMessage[] | null>();
  useEffect(() => {
    if (!wanted || items !== undefined) return;
    const base = `/accounts/${accountId}`;
    Promise.all([api<Settings>(`${base}/settings`), api<{ items: QuickMessage[] }>(`${base}/quick-messages`)])
      .then(([s, r]) => setItems(s.quick_message_status ? r.items : null))
      .catch(() => setItems(null));
  }, [wanted, items]);
  useEffect(() => onEvent((e) => (e.type === "quick_messages" || e.type === "settings") && e.accountId === accountId && setItems(undefined)), [accountId]);
  return items;
}
