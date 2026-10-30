import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/shared/utils/shadcn";

// round icon button with its label under it, as in PC's panel header
export function Toggle({ icon, active, children, ...props }: { icon: ReactNode; active?: boolean; children: ReactNode } & ComponentProps<"button">) {
  return (
    <button className="flex w-20 flex-col items-center gap-1 text-center text-xs" {...props}>
      <span className={cn("flex size-8 items-center justify-center rounded-full bg-muted [&_svg]:size-4", active && "bg-primary/15 text-primary")}>{icon}</span>
      {children}
    </button>
  );
}
