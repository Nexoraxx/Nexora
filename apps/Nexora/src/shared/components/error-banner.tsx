import { XIcon } from "lucide-react";
import { cn } from "@/shared/utils/shadcn";

// one look for every dismissible error: tinted row, text left, close button right
export function ErrorBanner({ text, onClose, className }: { text: string; onClose: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex items-start gap-2 bg-destructive/10 px-4 py-2 text-[13px] whitespace-pre-line text-destructive", className)}>
      <span className="min-w-0 flex-1 py-0.5">{text}</span>
      <button className="-mr-1 grid size-6 shrink-0 place-items-center rounded-md hover:bg-destructive/15" title="Đóng" onClick={onClose}>
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
