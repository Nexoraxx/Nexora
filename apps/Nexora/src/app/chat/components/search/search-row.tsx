import { XIcon } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

export function Row({ children, onClick, onRemove }: { children: React.ReactNode; onClick?: () => void; onRemove?: () => void }) {
  return (
    <div className="group/row flex items-center gap-2.5 px-3 py-1.5 hover:bg-muted">
      <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={onClick}>
        {children}
      </button>
      {onRemove && (
        <Button variant="ghost" size="icon-xs" className="invisible group-hover/row:visible" title="Xóa" onClick={onRemove}>
          <XIcon />
        </Button>
      )}
    </div>
  );
}
