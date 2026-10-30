import { inTauri } from "@/core/tauri/native";
import { invoke } from "@tauri-apps/api/core";

type ServerInfo = { port: number; token: string };

const query = new URLSearchParams(location.search);
export const server: Promise<ServerInfo> = inTauri ? invoke("server_info") : Promise.resolve({ port: Number(query.get("port")), token: query.get("token") ?? "" });

export async function api<T = void>(path: string, method = "GET", body?: unknown): Promise<T> {
  const { port, token } = await server;
  const form = body instanceof FormData;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: form ? { authorization: `Bearer ${token}` } : { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
  return (res.status === 202 || res.status === 204 ? undefined : await res.json()) as T;
}

export async function apiBlob(path: string) {
  const { port, token } = await server;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
  return res.blob();
}
