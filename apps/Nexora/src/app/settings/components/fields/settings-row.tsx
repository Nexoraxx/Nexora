import { MUTED } from "@/app/settings/constants/settings.constants";
import type { ReactNode } from "react";
import { cn } from "@/shared/utils/shadcn";

export function Row({ label, desc, children, onClick }: { label: ReactNode; desc?: string; children?: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left", onClick && "hover:bg-muted")} onClick={onClick}>
      <div className="min-w-0 flex-1">
        <div>{label}</div>
        {desc && <div className={MUTED}>{desc}</div>}
      </div>
      {children}
    </Tag>
  );
}
