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

// Decoded in workers: where the webview can't show JPEG XL, and for chat bubbles everywhere. Zalo's "thumb" of a JXL
// photo is the full photo itself, and an <img> keeps it decoded at full size: an album of 30 phone photos held
// gigabytes and filled in one by one. The workers scale bubbles down to `max` px and hand back a JPEG.
const POOL = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
const workers: Worker[] = [];
let nextId = 0;
const waiting = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>();
function decodeJxl(bytes: ArrayBuffer, max = 0): Promise<Blob> {
  const id = nextId++;
  let worker = workers[id % POOL];
  if (!worker) {
    worker = workers[id % POOL] = new Worker(new URL("../workers/jxl.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
      const w = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.blob) w?.resolve(data.blob);
      else w?.reject(new Error(data.error));
    };
  }
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, bytes, max }, [bytes]);
  });
}

// object URL per media url (and size): a JXL decode is costly and a thread shows the same photos over and over.
// ponytail: plain LRU of 300, revoked on eviction; size it by bytes if memory shows up
const loaded = new Map<string, Promise<string>>();
function load(accountId: string, url: string, max = 0) {
  const key = max ? `${url}#${max}` : url;
  const hit = loaded.get(key);
  if (hit) {
    loaded.delete(key);
    loaded.set(key, hit);
    return hit;
  }
  // through the server: it AES-decrypts E2EE blobs, and fetches the rest without CORS in the way
  const p = apiBlob(`/accounts/${accountId}/image?url=${encodeURIComponent(url)}`)
    .then(async (blob) => {
      if (!isJxl(url)) return URL.createObjectURL(blob);
      // a webview without OffscreenCanvas in workers (older macOS) shows it the way it shows a full photo
      const small = max ? await decodeJxl(await blob.arrayBuffer(), max).catch(() => null) : null;
      return URL.createObjectURL(small ?? ((await showsJxl()) ? new Blob([blob], { type: "image/jxl" }) : await decodeJxl(await blob.arrayBuffer())));
    })
    .catch((e) => {
      loaded.delete(key);
      throw e;
    });
  loaded.set(key, p);
  if (loaded.size > 300) {
    const [oldest, old] = loaded.entries().next().value!;
    loaded.delete(oldest);
    void old.then(URL.revokeObjectURL, () => {});
  }
  return p;
}

// E2EE media (the AES key rides in the href's e2esession= param) can't go straight into an <img>/<video>, nor can
// JPEG XL where the webview doesn't decode it: they come through load() as object URLs. Other urls load directly.
// max: the JXL photo is shown small (a bubble), scaled down to that many px. "" while loading, null when it can't be loaded.
export function useMediaSrc(accountId: string, url?: string, max = 0): string | null {
  const direct = !isE2eeMedia(url) && !isJxl(url);
  const [src, setSrc] = useState<string | null>(() => (direct ? (url ?? "") : ""));
  useEffect(() => {
    if (direct) return setSrc(url ?? "");
    let alive = true;
    setSrc("");
    (isE2eeMedia(url) || max ? Promise.resolve(false) : showsJxl())
      .then((native) => (native ? url! : load(accountId, url!, max)))
      .then((s) => alive && setSrc(s))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [accountId, url, max]);
  return src;
}
