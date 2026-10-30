import type { ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h4 className="mb-1.5 font-semibold">{title}</h4>
      <div className="divide-y rounded-lg border">{children}</div>
    </section>
  );
}
