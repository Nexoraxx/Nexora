import type { ReactNode } from "react";

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}
