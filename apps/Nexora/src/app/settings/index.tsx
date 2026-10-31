import { useState } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { AutoReplyManager } from "@/app/settings/components/auto-replies/auto-reply-manager";
import { QuickMessageManager } from "@/app/settings/components/quick-messages/quick-message-manager";
import type { Page } from "@/app/settings/models/settings.model";
import { MUTED } from "@/app/settings/constants/settings.constants";
import { Privacy } from "@/app/settings/pages/privacy-settings";
import { BlockList } from "@/app/settings/pages/block-list";
import { Messages } from "@/app/settings/pages/message-settings";
import { ToolbarEditor } from "@/app/chat/components/toolbar/toolbar-editor";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/utils/shadcn";

const TITLES: Record<Page, string> = {
  privacy: "Quyền riêng tư",
  messages: "Tin nhắn",
  toolbars: "Thanh công cụ",
  blocked: "Chặn tin nhắn",
  quick: "Tin nhắn nhanh",
  auto: "Trả lời tự động",
};
// sub-pages and the tab they go back to
const PARENT: Partial<Record<Page, Page>> = { blocked: "privacy", quick: "messages", auto: "messages" };

// Zalo PC's "Cài đặt", the tabs Nexora has: "Quyền riêng tư", "Tin nhắn" (quick messages, auto reply); plus "Thanh công cụ"
export function SettingsDialog({ accountId, online, onProfile, onClose }: { accountId: string; online: boolean; onProfile: (userId: string) => void; onClose: () => void }) {
  const [page, setPage] = useState<Page>("privacy");
  const parent = PARENT[page];
  const tab = parent ?? page;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="flex h-[80vh] w-[760px] max-w-[95vw] gap-0 p-0 sm:max-w-[760px]">
        <nav className="flex w-48 shrink-0 flex-col gap-1 border-r p-2">
          <DialogTitle className="px-2 py-2">Cài đặt</DialogTitle>
          {(["privacy", "messages", "toolbars"] as const).map((p) => (
            <button key={p} className={cn("rounded-md px-2 py-1.5 text-left hover:bg-muted", tab === p && "bg-primary/10 font-medium text-primary")} onClick={() => setPage(p)}>
              {TITLES[p]}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3 font-semibold">
            {parent && (
              <Button variant="ghost" size="icon-sm" title="Quay lại" onClick={() => setPage(parent)}>
                <ArrowLeftIcon />
              </Button>
            )}
            {TITLES[page]}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {/* kept on this device: no connection needed */}
            {page === "toolbars" ? (
              <ToolbarEditor />
            ) : !online ? (
              <p className={MUTED}>Cần kết nối</p>
            ) : page === "privacy" ? (
              <Privacy accountId={accountId} onBlockList={() => setPage("blocked")} />
            ) : page === "blocked" ? (
              <BlockList accountId={accountId} onProfile={onProfile} />
            ) : page === "messages" ? (
              <Messages accountId={accountId} onPage={setPage} />
            ) : page === "quick" ? (
              <QuickMessageManager accountId={accountId} />
            ) : (
              <AutoReplyManager accountId={accountId} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
