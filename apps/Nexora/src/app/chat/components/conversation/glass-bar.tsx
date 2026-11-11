import { useLayoutEffect, useRef, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/shared/utils/shadcn";

// A frosted bar floating over the messages (header, composer): a plain CSS backdrop blur, the same on every platform.
// Its height pads the message list; a growing bar (a new line in the composer, the reply bar) reports it within the
// frame it changed in, so the list doesn't jump a frame late.
export function GlassBar({ className, onHeight, children }: { className: string; onHeight: (height: number) => void; children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    let last = -1;
    const observer = new ResizeObserver(() => {
      const height = bar.current!.offsetHeight;
      if (height === last) return;
      last = height;
      flushSync(() => onHeight(height));
    });
    observer.observe(bar.current!);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={bar}
      className={cn(
        "absolute inset-x-3 z-2 overflow-hidden rounded-[18px] border border-white/60 bg-white/40 text-sm/[1.45] text-foreground shadow-[0_4px_20px_rgba(0,0,0,0.12)] backdrop-blur-md backdrop-saturate-150",
        "dark:border-white/10 dark:bg-card/60",
        className,
      )}
    >
      {children}
    </div>
  );
}
