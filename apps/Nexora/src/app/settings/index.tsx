import { useState } from "react";
import { ArrowLeftIcon, LaptopIcon, MoonIcon, SunIcon } from "lucide-react";
import { AutoReplyManager } from "@/app/settings/components/auto-replies/auto-reply-manager";
import { QuickMessageManager } from "@/app/settings/components/quick-messages/quick-message-manager";
import type { Page } from "@/app/settings/models/settings.model";
import { MUTED } from "@/app/settings/constants/settings.constants";
import { Privacy } from "@/app/settings/pages/privacy-settings";
import { BlockList } from "@/app/settings/pages/block-list";
import { Messages } from "@/app/settings/pages/message-settings";
import { SyncMessages } from "@/app/settings/pages/sync-settings";
import { ToolbarEditor } from "@/app/chat/components/toolbar/toolbar-editor";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/utils/shadcn";
import { useTheme, type Theme } from "@/shared/hooks/use-theme";

const TITLES: Record<Page, string> = {
  privacy: "Quyền riêng tư",
  messages: "Tin nhắn",
  sync: "Đồng bộ tin nhắn",
  toolbars: "Thanh công cụ",
  appearance: "Giao diện",
  blocked: "Chặn tin nhắn",
  quick: "Tin nhắn nhanh",
  auto: "Trả lời tự động",
};
// sub-pages and the tab they go back to
const PARENT: Partial<Record<Page, Page>> = { blocked: "privacy", quick: "messages", auto: "messages" };

const THEME_OPTIONS: { id: Theme; label: string; desc: string; icon: typeof SunIcon }[] = [
  { id: "light", label: "Giao diện Sáng", desc: "Nền trắng thanh lịch, hiển thị rõ ràng ban ngày", icon: SunIcon },
  { id: "dark", label: "Giao diện Tối", desc: "Nền than chì sâu dịu mắt, tiết kiệm pin và chống mỏi mắt", icon: MoonIcon },
  { id: "system", label: "Theo hệ thống", desc: "Tự động đổi theo cài đặt sáng/tối của hệ điều hành", icon: LaptopIcon },
];

// Zalo PC's "Cài đặt", the tabs Nexora has: "Quyền riêng tư", "Tin nhắn" (quick messages, auto reply), "Đồng bộ tin nhắn"; plus "Thanh công cụ", "Giao diện"
export function SettingsDialog({ accountId, online, onProfile, onClose }: { accountId: string; online: boolean; onProfile: (userId: string) => void; onClose: () => void }) {
  const [page, setPage] = useState<Page>("privacy");
  const { theme, setTheme } = useTheme();
  const parent = PARENT[page];
  const tab = parent ?? page;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="flex h-[80vh] w-[760px] max-w-[95vw] gap-0 p-0 sm:max-w-[760px]">
        <nav className="flex w-48 shrink-0 flex-col gap-1 border-r p-2">
          <DialogTitle className="px-2 py-2">Cài đặt</DialogTitle>
          {(["privacy", "messages", "sync", "toolbars", "appearance"] as const).map((p) => (
            <button key={p} className={cn("rounded-md px-2 py-1.5 text-left hover:bg-muted cursor-pointer transition-colors", tab === p && "bg-primary/10 font-medium text-primary")} onClick={() => setPage(p)}>
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
            {page === "appearance" ? (
              <div className="space-y-4 max-w-lg">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Chủ đề giao diện</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Chọn giao diện phù hợp với sở thích hoặc điều kiện ánh sáng của bạn.
                  </p>
                </div>
                <div className="grid gap-2.5">
                  {THEME_OPTIONS.map((opt) => {
                    const active = theme === opt.id;
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setTheme(opt.id)}
                        className={cn(
                          "flex items-center gap-3.5 p-3 rounded-xl border text-left transition-all cursor-pointer",
                          active
                            ? "border-primary bg-primary/8 ring-1 ring-primary/40 shadow-xs"
                            : "border-border/60 hover:border-border hover:bg-muted/40 text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <div className={cn(
                          "size-9 rounded-lg flex items-center justify-center shrink-0 border",
                          active ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border/60"
                        )}>
                          <Icon className="size-4.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className={cn("text-xs font-semibold block", active ? "text-foreground" : "text-foreground/90")}>
                            {opt.label}
                          </span>
                          <span className="text-[11px] text-muted-foreground mt-0.5 block">
                            {opt.desc}
                          </span>
                        </div>
                        {active && (
                          <span className="size-2 rounded-full bg-primary shrink-0 mr-1" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : page === "toolbars" ? (
              <ToolbarEditor />
            ) : !online ? (
              <p className={MUTED}>Cần kết nối</p>
            ) : page === "privacy" ? (
              <Privacy accountId={accountId} onBlockList={() => setPage("blocked")} />
            ) : page === "blocked" ? (
              <BlockList accountId={accountId} onProfile={onProfile} />
            ) : page === "messages" ? (
              <Messages accountId={accountId} onPage={setPage} />
            ) : page === "sync" ? (
              <SyncMessages accountId={accountId} />
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
