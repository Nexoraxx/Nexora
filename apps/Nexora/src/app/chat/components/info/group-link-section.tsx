import { useEffect, useState } from "react";
import { CopyIcon, LinkIcon } from "lucide-react";
import { api } from "@/core/http/api";
import type { GroupLink } from "@/shared/types";
import type { Ask } from "@/shared/models/dialog.model";
import { Section } from "@/app/chat/components/info/info-section";
import { Button } from "@/shared/components/ui/button";

// "Link tham gia nhóm": everyone sees it while it's on; owner and deputies turn it on, swap it or turn it off
export function GroupLinkSection({ base, admin, onAsk }: { base: string; admin: boolean; onAsk: (a: Ask) => void }) {
  const [link, setLink] = useState<GroupLink>();
  const [note, setNote] = useState<string>();
  useEffect(() => {
    api<GroupLink>(`${base}/link`)
      .then(setLink)
      .catch(() => setLink(undefined));
  }, [base]);
  if (!link || (!link.enabled && !admin)) return null;

  const renew = () => api<GroupLink>(`${base}/link`, "POST").then(setLink);
  const copy = (url: string) => navigator.clipboard.writeText(url).then(() => setNote("Sao chép link thành công"), () => setNote("Sao chép link thất bại"));
  return (
    <Section title="Link tham gia nhóm">
      {link.enabled && link.link ? (
        <div className="flex items-center gap-2 px-4 py-1.5">
          <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-primary">{link.link}</span>
          <Button variant="ghost" size="icon-xs" title="Sao chép link" onClick={() => copy(link.link!)}>
            <CopyIcon />
          </Button>
        </div>
      ) : (
        <p className="px-4 py-1 text-xs text-muted-foreground">Link tham gia nhóm đang tắt</p>
      )}
      {note && <p className="px-4 text-xs text-muted-foreground">{note}</p>}
      {admin && (
        <div className="flex gap-2 px-4 pt-1">
          {link.enabled ? (
            <>
              <Button variant="outline" size="sm" onClick={() => onAsk({ title: "Đổi link", message: "Link hiện tại sẽ không sử dụng được nữa. Đổi link tham gia nhóm?", ok: "Đổi link", run: renew })}>
                Đổi link
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onAsk({
                    title: "Tắt link",
                    message: "Link hiện tại sẽ không sử dụng được nữa. Tắt link tham gia nhóm?",
                    ok: "Tắt link",
                    run: () => api(`${base}/link`, "DELETE").then(() => setLink({ ...link, enabled: false })),
                  })
                }
              >
                Tắt link
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => renew().catch((e) => setNote(e.message))}>
              Tạo link
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}
