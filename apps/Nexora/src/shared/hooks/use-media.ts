import { useEffect, useState } from "react";
import { apiBlob } from "@/core/http/api";

export const isE2eeMedia = (url?: string) => !!url && /[?&]e2esession=/.test(url);
// Zalo PC's isJxlUrl: photos uploaded from phones (…/jxl/….jxl), kept as Zalo sends them
export const isJxl = (url?: string) => !!url && /^https?:\/\/.*\/jxl\/.*\.jxl/.test(url);

// ===== JPEG XL =====

// A 1×1 JPEG XL: WebKitGTK built with libjxl and Safari 17+ (macOS) show JXL themselves, WebView2 (Windows) doesn't
const JXL_PIXEL = "data:image/jxl;base64,/woAEBAJCAABACgASxiLFcJJQU5/AA==";
let nativeJxl: Promise<boolean> | undefined;
const showsJxl = () =>
  (nativeJxl ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth === 1);
    img.onerror = () => resolve(false);
    img.src = JXL_PIXEL;
  }));

// where the webview can't, decoded in a worker

let worker: Worker | undefined;
let nextId = 0;
const waiting = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>();
function decodeJxl(bytes: ArrayBuffer): Promise<Blob> {
  if (!worker) {
    worker = new Worker(new URL("../workers/jxl.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
      const w = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.blob) w?.resolve(data.blob);
      else w?.reject(new Error(data.error));
    };
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker!.postMessage({ id, bytes }, [bytes]);
  });
}

// object URL per media url: a JXL decode is costly and a thread shows the same photos over and over.
// ponytail: plain LRU of 300, revoked on eviction; size it by bytes if memory shows up
const loaded = new Map<string, Promise<string>>();
function load(accountId: string, url: string) {
  const hit = loaded.get(url);
  if (hit) {
    loaded.delete(url);
    loaded.set(url, hit);
    return hit;
  }
  // through the server: it AES-decrypts E2EE blobs, and fetches the rest without CORS in the way
  const p = apiBlob(`/accounts/${accountId}/image?url=${encodeURIComponent(url)}`)
    .then(async (blob) => URL.createObjectURL(!isJxl(url) ? blob : (await showsJxl()) ? new Blob([blob], { type: "image/jxl" }) : await decodeJxl(await blob.arrayBuffer())))
    .catch((e) => {
      loaded.delete(url);
      throw e;
    });
  loaded.set(url, p);
  if (loaded.size > 300) {
    const [oldest, old] = loaded.entries().next().value!;
    loaded.delete(oldest);
    void old.then(URL.revokeObjectURL, () => {});
  }
  return p;
}

// E2EE media (the AES key rides in the href's e2esession= param) can't go straight into an <img>/<video>, nor can
// JPEG XL where the webview doesn't decode it: they come through load() as object URLs. Other urls load directly.
// "" while loading, null when it can't be loaded.
export function useMediaSrc(accountId: string, url?: string): string | null {
  const direct = !isE2eeMedia(url) && !isJxl(url);
  const [src, setSrc] = useState<string | null>(() => (direct ? (url ?? "") : ""));
  useEffect(() => {
    if (direct) return setSrc(url ?? "");
    let alive = true;
    setSrc("");
    (isE2eeMedia(url) ? Promise.resolve(false) : showsJxl())
      .then((native) => (native ? url! : load(accountId, url!)))
      .then((s) => alive && setSrc(s))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [accountId, url]);
  return src;
}
