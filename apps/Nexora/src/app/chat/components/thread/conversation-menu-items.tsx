import { api } from "@/core/http/api";
import type { ConversationSettings } from "@/shared/types";
import { labelOf } from "@/app/chat/utils/chat.utils";
import { CheckIcon } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/shared/components/ui/dropdown-menu";

// Zalo PC's conversation list menu: pin, label, unread mark, "Ưu tiên" / "Khác", hide, delete. Items that need a
// dialog ask for it through onDialog.
export function ConversationMenuItems({
  accountId,
  threadId,
  isGroup,
  unread,
  settings,
  run,
  onDialog,
}: {
  accountId: string;
  threadId: string;
  isGroup: boolean;
  // unread messages or a mark: "Đánh dấu đã đọc" instead of "Đánh dấu chưa đọc"
  unread: boolean;
  settings: ConversationSettings;
  run: (p: Promise<unknown>) => void;
  onDialog: (d: "hide" | "delete" | "labels") => void;
}) {
  const base = `/accounts/${accountId}/conversations/${threadId}`;
  const pinned = settings.pinned.includes(threadId);
  const archived = settings.archived.includes(threadId);
  const hidden = settings.hidden.includes(threadId);
  const label = labelOf(settings, threadId);
  const marked = settings.unread.includes(threadId);
  const setLabel = (labelId: number | null) => run(api(`${base}/label`, "PUT", { isGroup, labelId }));
  return (
    <>
      <DropdownMenuItem onSelect={() => run(api(`${base}/pin`, "PUT", { isGroup, pinned: !pinned }))}>{pinned ? "Bỏ ghim hội thoại" : "Ghim hội thoại"}</DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Phân loại</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-52">
          {settings.labels.map((l) => (
            <DropdownMenuItem key={l.id} onSelect={() => setLabel(label?.id === l.id ? null : l.id)}>
              <span className="size-3 shrink-0 rounded-sm" style={{ background: l.color }} />
              <span className="flex-1 truncate">{l.text}</span>
              {label?.id === l.id && <CheckIcon />}
            </DropdownMenuItem>
          ))}
          {!settings.labels.length && <div className="px-2 py-1.5 text-xs text-muted-foreground">Chưa có phân loại</div>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onDialog("labels")}>Quản lý thẻ phân loại</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem onSelect={() => run(api(`${base}/unread`, "PUT", { isGroup, unread: !unread }))}>{unread || marked ? "Đánh dấu đã đọc" : "Đánh dấu chưa đọc"}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => run(api(`${base}/archived`, "PUT", { isGroup, archived: !archived }))}>
        {archived ? "Chuyển sang mục Ưu tiên" : "Chuyển sang mục Khác"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => (hidden ? run(api(`${base}/hidden`, "PUT", { isGroup, hidden: false })) : onDialog("hide"))}>
        {hidden ? "Bỏ ẩn trò chuyện" : "Ẩn trò chuyện"}
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onSelect={() => onDialog("delete")}>
        Xóa hội thoại
      </DropdownMenuItem>
    </>
  );
}
