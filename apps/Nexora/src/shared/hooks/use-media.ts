import { useEffect, useState } from "react";
import { apiBlob } from "@/core/http/api";

export const isE2eeMedia = (url?: string) => !!url && /[?&]e2esession=/.test(url);

// An E2EE media url (href carries the AES key in its e2esession= param) points at an encrypted blob the browser can't
// decode: fetch it through the server, which AES-decrypts it, and show the result as an object URL. Plaintext urls load
// directly. Returns "" while an E2EE blob is still loading.
export function useMediaSrc(accountId: string, url?: string): string {
  const [src, setSrc] = useState(() => (isE2eeMedia(url) ? "" : (url ?? "")));
  useEffect(() => {
    if (!isE2eeMedia(url)) {
      setSrc(url ?? "");
      return;
    }
    let objectUrl = "";
    let alive = true;
    apiBlob(`/accounts/${accountId}/image?url=${encodeURIComponent(url!)}`)
      .then((blob) => {
        if (alive) setSrc((objectUrl = URL.createObjectURL(blob)));
      })
      .catch(() => alive && setSrc(""));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, url]);
  return src;
}
