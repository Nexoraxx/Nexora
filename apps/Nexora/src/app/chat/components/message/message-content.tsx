import { openExternal } from "@/core/tauri/native";
import type { MessageRow } from "@/shared/types";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { RichText } from "@/app/chat/components/message/rich-text";
import { Formatted } from "@/app/chat/components/message/formatted";
import { MENTION_ALL } from "@/shared/constants/text.constants";
import { splitMentions } from "@/shared/utils/text.utils";
import type { TextStyle } from "@/shared/models/text.model";
import { attach, fileSize, params, summary } from "@/app/chat/utils/chat.utils";
import { E2EE } from "@/app/chat/constants/chat.constants";
import { useState } from "react";
import { LinkIcon, ListChecksIcon, LockIcon, MapPinIcon, MicOffIcon, StickerIcon, VideoOffIcon } from "lucide-react";
import { Img, Placeholder } from "@/shared/components/img";
import { cn } from "@/shared/utils/shadcn";
import { useMediaSrc } from "@/shared/hooks/use-media";
import { FileBubble } from "@/app/file-viewer/components/bubble/file-bubble";
import { openViewer } from "@/app/file-viewer/services/file-viewer.service";
import { fileFromUrl, getExtension } from "@/app/file-viewer/utils/file-viewer.utils";

// Zalo PC's sticker image endpoint; the built-in "Củ hành" set (category 0) lives on its static domain
const stickerImage = (id: unknown, catId?: unknown) =>
  catId === 0 ? `https://stc-chat.zdn.vn/images/stickers/default/${id}.gif` : `https://api.zaloapp.com/api/emoticon/sticker/webpc?size=130&eid=${id}`;

const CARD = "flex max-w-80 items-center gap-2 rounded-md border bg-white px-3 py-1.5 text-left";
const FILE = `${CARD} hover:bg-muted`;

export function Content({ m, me, onProfile, onPoll }: { m: MessageRow; me: string; onProfile: (userId: string) => void; onPoll?: (pollId: string) => void }) {
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
      return <Photo accountId={me} href={c.href} thumb={c.thumb} />;
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
function Photo({ accountId, href, thumb }: { accountId: string; href?: string; thumb?: string }) {
  const url = href || thumb;
  const src = useMediaSrc(accountId, url);
  return <Img className="max-h-80 max-w-70 cursor-pointer rounded-md bg-muted" fallbackClassName="size-40" src={url ? src : null} onClick={() => url && openViewer({ ...fileFromUrl(url), accountId })} />;
}

function Media({ kind, accountId, href, thumb }: { kind: "video" | "audio"; accountId: string; href?: string; thumb?: string }) {
  const src = useMediaSrc(accountId, href);
  const poster = useMediaSrc(accountId, thumb);
  const [broken, setBroken] = useState(false);
  if (!href || src === null || broken)
    return kind === "video" ? (
      <Placeholder icon={VideoOffIcon} label="Không phát được video" className="size-40 rounded-md" />
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
