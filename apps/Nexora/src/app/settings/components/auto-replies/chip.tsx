import { cn } from "@/shared/utils/shadcn";

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")} onClick={onClick}>
      {children}
    </button>
  );
}
