import type { ReactNode } from "react";
import { cn } from "@/shared/utils/shadcn";

export function ActionRow({ icon, className, onClick, children }: { icon: ReactNode; className?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className={cn("flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground", className)} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}
