import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import { onEvent } from "@/core/websocket/events";
import type { Settings as SettingsMap } from "@/shared/types";

// the account's settings, followed live (changes here or on another device); a failed change shows the old value
export function useSettings(accountId: string) {
  const [settings, setSettings] = useState<SettingsMap>();
  const [error, setError] = useState<string>();
  const base = `/accounts/${accountId}/settings`;
  const load = () => api<SettingsMap>(base).then(setSettings, (e) => setError(e.message));
  useEffect(() => {
    load();
    return onEvent((e) => e.type === "settings" && e.accountId === accountId && load());
  }, [accountId]);
  const set = (key: string, value: number) => {
    setError(undefined);
    setSettings((s) => s && { ...s, [key]: value });
    api<SettingsMap>(base, "PATCH", { key, value }).then(setSettings, (e) => (setError(e.message), load()));
  };
  return { settings, error, set };
}
