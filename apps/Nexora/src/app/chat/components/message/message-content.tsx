import { openExternal } from "@/core/tauri/native";
import type { MessageRow } from "@/shared/types";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { RichText } from "@/app/chat/components/message/rich-text";
import { Formatted } from "@/app/chat/components/message/formatted";
import { MENTION_ALL } from "@/shared/constants/text.constants";
import { splitMentions } from "@/shared/utils/text.utils";
import type { TextStyle } from "@/shared/models/text.model";
import { attach, CALL_LOGS, callLog, fileSize, params, summary } from "@/app/chat/utils/chat.utils";
import { E2EE } from "@/app/chat/constants/chat.constants";
import { useEffect, useRef, useState, type RefObject } from "react";
import { LinkIcon, ListChecksIcon, LockIcon, MapPinIcon, MicOffIcon, PhoneIncomingIcon, PhoneMissedIcon, PhoneOutgoingIcon, StickerIcon, VideoIcon, VideoOffIcon } from "lucide-react";
import { Img, Placeholder } from "@/shared/components/img";
import { cn } from "@/shared/utils/shadcn";
import { isE2eeMedia, useMediaSrc } from "@/shared/hooks/use-media";
import { FileBubble } from "@/app/file-viewer/components/bubble/file-bubble";
import { openViewer } from "@/app/file-viewer/services/file-viewer.service";
import { fileFromUrl, getExtension } from "@/app/file-viewer/utils/file-viewer.utils";

// Zalo PC's sticker image endpoint; the built-in "Củ hành" set (category 0) lives on its static domain
const stickerImage = (id: unknown, catId?: unknown) =>
  catId === 0 ? `https://stc-chat.zdn.vn/images/stickers/default/${id}.gif` : `https://api.zaloapp.com/api/emoticon/sticker/webpc?size=130&eid=${id}`;

// a photo in a bubble fits 280 × 320 px (max-w-70 max-h-80); decoded at about twice that for sharp screens
const BUBBLE_W = 280;
const BUBBLE_H = 320;
const BUBBLE_PX = 640;
// photos an album bubble shows before "+N"
const ALBUM_MAX = 9;

const CARD = "flex max-w-80 items-center gap-2 rounded-md border bg-white dark:bg-card dark:border-border/60 px-3 py-1.5 text-left";
const FILE = `${CARD} hover:bg-muted`;

export function Content({
  m,
  me,
  onProfile,
  onPoll,
  onCall,
}: {
  m: MessageRow;
  me: string;
  onProfile: (userId: string) => void;
  onPoll?: (pollId: string) => void;
  // "GỌI LẠI" on a call log
  onCall?: (video: boolean) => void;
}) {
  const c = attach(m.content);
  switch (m.msgType) {
    case E2EE:
      // e2eeStatus set: decryption was tried and failed; unset: a type Nexora can't decrypt yet
      return m.e2eeStatus ? (
        <span className="flex items-center gap-1.5 text-muted-foreground italic">
          <LockIcon className="size-3.5" /> Giải mã tin nhắn không thành công.
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-muted-foreground italic" title="Nexora chưa đọc được loại tin nhắn mã hóa này: hãy xem trên điện thoại">
          <LockIcon className="size-3.5" /> Tin nhắn được mã hoá đầu cuối
        </span>
      );
    case "webchat":
      // "Định dạng tin nhắn" arrives as rtf content: the text in title, the styles in params
      if (c.action === "rtf") return <Formatted text={c.title ?? ""} styles={params(c).styles as TextStyle[]} mentions={m.mentions} me={me} onProfile={onProfile} />;
      return (
        <div className="whitespace-pre-wrap wrap-anywhere">
          {splitMentions(String(m.content ?? ""), m.mentions).map((part, i) =>
            typeof part === "string" ? (
              <RichText key={i} text={part} />
            ) : (
              <button
                key={i}
                className={cn("font-medium text-primary", (part.uid === me || part.uid === MENTION_ALL) && "rounded bg-primary/15 px-0.5")}
                onClick={() => part.uid !== MENTION_ALL && onProfile(part.uid)}
              >
                {part.text}
              </button>
            ),
          )}
        </div>
      );
    case "chat.photo":
    case "chat.gif":
    case "chat.doodle":
      return <Photo accountId={me} href={c.href} thumb={c.thumb} width={Number(params(c).width) || 0} height={Number(params(c).height) || 0} />;
    case "chat.sticker":
      return <Img className="size-30" fallbackClassName="rounded-md" src={stickerImage(c.id, c.catId)} alt="sticker" icon={StickerIcon} />;
    case "chat.video.msg":
      return <Media kind="video" accountId={me} href={c.href} thumb={c.thumb} />;
    case "chat.voice":
      return <Media kind="audio" accountId={me} href={c.href} />;
    case "share.file":
      // Zalo PC sends a picked video as a file and plays .mp4 files in place (media_files.supported_exts without video_file_v2)
      if (String(params(c).fileExt ?? "").toLowerCase() === "mp4")
        return (
          <div>
            <Media kind="video" accountId={me} href={c.href} />
            <div className="mt-0.5 max-w-70 truncate text-xs text-muted-foreground">
              {c.title} · {fileSize(params(c).fileSize)}
            </div>
          </div>
        );
      return <FileBubble file={{ name: c.title ?? "", ext: String(params(c).fileExt || getExtension(c.title ?? "")).toLowerCase(), size: Number(params(c).fileSize) || undefined, url: c.href, accountId: me }} />;
    case "chat.location.new": {
      const p = params(c);
      const where = p.latitude != null ? `${p.latitude},${p.longitude}` : c.title || c.description || "";
      return (
        <button className={FILE} onClick={() => openExternal(`https://www.google.com/maps?q=${encodeURIComponent(where)}`)}>
          <MapPinIcon className="size-5 shrink-0 text-red-500" />
          <div>
            <b>{c.title || "Vị trí"}</b>
            {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
          </div>
        </button>
      );
    }
    // create / vote / close of a poll: opens it
    case "group.poll": {
      const pollId = params(c).pollId;
      return (
        <button className={FILE} disabled={!onPoll || pollId == null} onClick={() => onPoll?.(String(pollId))}>
          <ListChecksIcon className="size-5 shrink-0 text-primary" />
          <div>
            <b>{String(params(c).question ?? c.title ?? "")}</b>
            <div className="text-xs text-muted-foreground">{c.action === "close" ? "Bình chọn đã kết thúc" : "Bình chọn"}</div>
          </div>
        </button>
      );
    }
    // contact card: params is the user id
    case "chat.recommended":
      if (CALL_LOGS.has(c.action ?? "")) {
        const log = callLog(c, m.fromUid === me);
        const Icon = log.video ? VideoIcon : log.missed ? PhoneMissedIcon : log.out ? PhoneOutgoingIcon : PhoneIncomingIcon;
        return (
          <div className="min-w-48">
            <b className={cn(log.missed && "text-destructive")}>{log.title}</b>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className={cn("size-3.5", log.missed && "text-destructive")} /> {log.text}
            </div>
            {log.callback && onCall && (
              <button className="mt-2 w-full rounded-md bg-muted py-1 text-xs font-semibold text-primary hover:bg-muted/70" onClick={() => onCall(log.video)}>
                GỌI LẠI
              </button>
            )}
          </div>
        );
      }
      if (c.action === "recommened.user")
        return (
          <button className={FILE} onClick={() => c.params && onProfile(c.params)}>
            <Avatar src={c.thumb} name={c.title ?? "?"} size={40} />
            <div>
              <b>{c.title}</b>
              <div className="text-xs text-muted-foreground">Danh thiếp</div>
            </div>
          </button>
        );
      if (c.action !== "recommened.link") return <i className="text-xs text-muted-foreground">{summary(m.msgType, m.content)}</i>;
      return (
        <button className={FILE} onClick={() => c.href && openExternal(c.href)}>
          {c.thumb && <Img className="size-16 shrink-0 rounded object-cover" src={c.thumb} icon={LinkIcon} />}
          <div>
            <b>{c.title || c.href}</b>
            {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
          </div>
        </button>
      );
    case "chat.undo":
      return <i className="text-xs text-muted-foreground">Tin nhắn đã được thu hồi</i>;
    default:
      return <i className="text-xs text-muted-foreground">{summary(m.msgType, m.content)}</i>;
  }
}

// E2EE photos/videos/voice are AES-encrypted blobs: useMediaSrc fetches them through the decrypting proxy; plaintext
// urls pass straight through. A hook can't live inside the switch, so media gets its own components.
function Photo({ accountId, href, thumb, cell, width = 0, height = 0 }: { accountId: string; href?: string; thumb?: string; cell?: boolean; width?: number; height?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  const near = useNear(box);
  // the bubble shows the thumbnail, scaled down when it's a JXL (whose thumb is the full photo), the viewer the full
  // photo. E2EE photos keep href: the AES key rides in its e2esession= param
  const url = isE2eeMedia(href) ? href : thumb || href;
  const full = href || thumb;
  const src = useMediaSrc(accountId, near ? url : undefined, BUBBLE_PX);
  // an expired or undecodable photo: the bubble shrinks to the placeholder tile instead of keeping the photo's box
  const [brokenSrc, setBrokenSrc] = useState<string>();
  const failed = !url || src === null || (!!src && brokenSrc === src);
  // its box is sized from the photo's own dimensions before it loads: the skeleton has its shape and nothing jumps
  const scale = width && height ? Math.min(1, BUBBLE_W / width, BUBBLE_H / height) : 0;
  const sized = !cell && !failed && scale > 0;
  return (
    <span ref={box} className={cn("block", cell ? "size-full" : !sized && "min-h-20 min-w-20")} style={sized ? { width: Math.round(width * scale), height: Math.round(height * scale) } : undefined}>
      <Img
        className={cn("cursor-pointer rounded-md", cell ? "aspect-square size-full object-cover" : sized ? "size-full object-cover" : "max-h-80 max-w-70 min-h-20 min-w-20 object-cover")}
        fallbackClassName={cell ? undefined : "size-40"}
        caption
        src={url ? src : null}
        decoding="async"
        onError={() => setBrokenSrc(src || undefined)}
        onClick={() => full && openViewer({ ...fileFromUrl(full), accountId })}
      />
    </span>
  );
}

// true once the element has come into view (it stays true): a photo is fetched and decoded only when shown
function useNear(ref: RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near || !ref.current) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "400px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [near]);
  return near;
}

// Zalo's album bubble: photos sent together as one grid, 2 per row for 2 or 4, else 3. A big album shows its first
// ALBUM_MAX with "+N" on the last; that cell opens the rest in place.
export function Album({ photos, me }: { photos: MessageRow[]; me: string }) {
  const [open, setOpen] = useState(false);
  const cut = !open && photos.length > ALBUM_MAX;
  const shown = cut ? photos.slice(0, ALBUM_MAX) : photos;
  const cols = photos.length === 2 || photos.length === 4 ? "grid-cols-2" : "grid-cols-3";
  return (
    <div className={cn("grid w-80 max-w-full gap-1", cols)}>
      {shown.map((p, i) => {
        const c = attach(p.content);
        const photo = <Photo key={p.msgId} accountId={me} href={c.href} thumb={c.thumb} cell />;
        if (!cut || i < ALBUM_MAX - 1) return photo;
        return (
          <div key={p.msgId} className="relative">
            {photo}
            <button className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50 text-xl font-semibold text-white" onClick={() => setOpen(true)}>
              +{photos.length - ALBUM_MAX + 1}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Media({ kind, accountId, href, thumb }: { kind: "video" | "audio"; accountId: string; href?: string; thumb?: string }) {
  const src = useMediaSrc(accountId, href);
  const poster = useMediaSrc(accountId, thumb, BUBBLE_PX);
  const [broken, setBroken] = useState(false);
  if (!href || src === null || broken)
    return kind === "video" ? (
      <Placeholder icon={VideoOffIcon} label="Không phát được video" caption className="size-40 rounded-md" />
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
        <MicOffIcon className="size-3.5" /> Không phát được tin nhắn thoại
      </span>
    );
  return kind === "video" ? (
    <video className="max-h-80 max-w-70 rounded-md" src={src || undefined} poster={poster || undefined} controls preload="metadata" onError={() => setBroken(true)} />
  ) : (
    <audio src={src || undefined} controls onError={() => setBroken(true)} />
  );
}
