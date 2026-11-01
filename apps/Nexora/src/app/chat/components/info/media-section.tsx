import { useEffect, useState } from "react";
import { FileTextIcon, LinkIcon, PlayIcon, VideoOffIcon } from "lucide-react";
import { api } from "@/core/http/api";
import { attach, fileSize, params } from "@/app/chat/utils/chat.utils";
import { openExternal } from "@/core/tauri/native";
import type { MediaItem } from "@/shared/types";
import { Section } from "@/app/chat/components/info/info-section";
import { Button } from "@/shared/components/ui/button";
import { openViewer } from "@/app/file-viewer/services/file-viewer.service";
import { fileFromUrl, getExtension } from "@/app/file-viewer/utils/file-viewer.utils";
import { useMediaSrc } from "@/shared/hooks/use-media";
import { Img } from "@/shared/components/img";

const host = (href?: string) => {
  try {
    return href ? new URL(href).host : "";
  } catch {
    return href ?? "";
  }
};

// local history only, as Zalo PC (its media cloud is off by default); "Xem tất cả" loads up to 200
// accountId: E2EE and JPEG XL photos load through it
export function MediaSection({ accountId, base, kind, title, preview }: { accountId: string; base: string; kind: "media" | "file" | "link"; title: string; preview: number }) {
  const [items, setItems] = useState<MediaItem[]>();
  const [all, setAll] = useState(false);
  useEffect(() => {
    api<MediaItem[]>(`${base}?kind=${kind}&limit=${all ? 200 : preview + 1}`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [base, all]);

  const shown = all ? items : items?.slice(0, preview);
  return (
    <Section title={title}>
      {!items ? (
        <p className="px-4 py-1 text-xs text-muted-foreground">Đang tải…</p>
      ) : !items.length ? (
        <p className="px-4 py-1 text-xs text-muted-foreground">Chưa có {title} được chia sẻ trong hội thoại này</p>
      ) : kind === "media" ? (
        <div className="grid grid-cols-4 gap-1 px-4">
          {shown!.map((m) => {
            const c = attach(m.content);
            return (
              <button
                key={m.msgId}
                className="relative aspect-square overflow-hidden rounded-md bg-muted"
                onClick={() => c.href && openViewer({ ...fileFromUrl(c.href), accountId })}
              >
                {(c.thumb || c.href) && <Thumb accountId={accountId} url={(c.thumb || c.href)!} video={m.msgType === "chat.video.msg"} />}
                {m.msgType === "chat.video.msg" && <PlayIcon className="absolute inset-0 m-auto size-6 fill-white text-white drop-shadow" />}
              </button>
            );
          })}
        </div>
      ) : (
        shown!.map((m) => {
          const c = attach(m.content);
          return (
            <button
              key={m.msgId}
              className="flex w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-muted"
              onClick={() =>
                c.href &&
                (kind === "file"
                  ? openViewer({ name: c.title ?? "", ext: String(params(c).fileExt || getExtension(c.title ?? "")).toLowerCase(), size: Number(params(c).fileSize) || undefined, url: c.href, accountId })
                  : openExternal(c.href))
              }
            >
              {kind === "link" && c.thumb ? (
                <Img className="size-10 shrink-0 rounded object-cover" src={c.thumb} icon={LinkIcon} />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded bg-muted [&_svg]:size-5 [&_svg]:text-muted-foreground">
                  {kind === "file" ? <FileTextIcon /> : <LinkIcon />}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate">{c.title || c.href}</div>
                <div className="truncate text-xs text-muted-foreground">{kind === "file" ? fileSize(params(c).fileSize) : host(c.href)}</div>
              </div>
            </button>
          );
        })
      )}
      {!all && items && items.length > preview && (
        <div className="px-4 pt-2">
          <Button variant="secondary" className="w-full" onClick={() => setAll(true)}>
            Xem tất cả
          </Button>
        </div>
      )}
    </Section>
  );
}

function Thumb({ accountId, url, video }: { accountId: string; url: string; video: boolean }) {
  const src = useMediaSrc(accountId, url);
  return <Img className="size-full object-cover" src={src} icon={video ? VideoOffIcon : undefined} />;
}
