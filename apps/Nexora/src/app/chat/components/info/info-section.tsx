import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/shared/utils/shadcn";

export function Section({ title, count, children }: { title: string; count?: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-t-8 border-muted py-2">
      <button className="flex w-full items-center justify-between px-4 py-1.5 font-semibold" onClick={() => setOpen((o) => !o)}>
        {title}
        <ChevronDownIcon className={cn("size-4 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <>
          {count && <div className="px-4 pb-1 text-xs text-muted-foreground">{count}</div>}
          {children}
        </>
      )}
    </section>
  );
}
