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
import { FileTextIcon, ListChecksIcon, LockIcon, MapPinIcon } from "lucide-react";
import { cn } from "@/shared/utils/shadcn";

// Zalo PC's sticker image endpoint; the built-in "Củ hành" set (category 0) lives on its static domain
const stickerImage = (id: unknown, catId?: unknown) =>
  catId === 0 ? `https://stc-chat.zdn.vn/images/stickers/default/${id}.gif` : `https://api.zaloapp.com/api/emoticon/sticker/webpc?size=130&eid=${id}`;

const CARD = "flex max-w-80 items-center gap-2 rounded-md border bg-white px-3 py-1.5 text-left";
const FILE = `${CARD} hover:bg-muted`;

export function Content({ m, me, onProfile, onPoll }: { m: MessageRow; me: string; onProfile: (userId: string) => void; onPoll?: (pollId: string) => void }) {
  const c = attach(m.content);
  switch (m.msgType) {
    case E2EE:
      return (
        <span className="flex items-center gap-1.5 text-muted-foreground italic" title="Nexora chưa hỗ trợ mã hóa đầu cuối: hãy đọc tin này trên điện thoại">
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
      return <img className="max-h-80 max-w-70 cursor-pointer rounded-md" src={c.href || c.thumb} alt="" onClick={() => c.href && openExternal(c.href)} />;
    case "chat.sticker":
      return <img className="size-30" src={stickerImage(c.id, c.catId)} alt="sticker" />;
    case "chat.video.msg":
      return <video className="max-h-80 max-w-70 rounded-md" src={c.href} poster={c.thumb} controls />;
    case "chat.voice":
      return <audio src={c.href} controls />;
    case "share.file":
      // Zalo PC sends a picked video as a file and plays .mp4 files in place (media_files.supported_exts without video_file_v2)
      if (String(params(c).fileExt ?? "").toLowerCase() === "mp4")
        return (
          <div>
            <video className="max-h-80 max-w-70 rounded-md" src={c.href} controls preload="metadata" />
            <div className="mt-0.5 max-w-70 truncate text-xs text-muted-foreground">
              {c.title} · {fileSize(params(c).fileSize)}
            </div>
          </div>
        );
      return (
        <button className={FILE} onClick={() => c.href && openExternal(c.href)}>
          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" /> <span>{c.title}</span> <span className="shrink-0 text-xs text-muted-foreground">{fileSize(params(c).fileSize)}</span>
        </button>
      );
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
          {c.thumb && <img className="size-16 shrink-0 rounded object-cover" src={c.thumb} alt="" />}
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
