import { useLayoutEffect, useRef, type ReactNode } from "react";
import { flushSync } from "react-dom";
import LiquidGlass from "liquid-glass-react";
import { cn } from "@/shared/utils/shadcn";

// WebKit (the Linux/macOS webviews) can't run the SVG refraction on the backdrop; it filters the empty warp layer
// instead and the displacement map shows up as a light box mid-glass, so there only the blur is kept.
const refraction = /Chrome\//.test(navigator.userAgent);

// liquid-glass-react centers its layers on style.top/left (translate -50%) and sizes them from the content, so a
// full-width bar sits in an absolute dock whose height is measured from that content. elasticity 0: a bar must
// not stretch toward the mouse. WebKit (Linux, macOS) draws only the blur and highlights; the SVG refraction
// needs Chromium (WebView2 on Windows).
export function GlassBar({ className, onHeight, children }: { className: string; onHeight: (height: number) => void; children: ReactNode }) {
  const dock = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  // A growing bar (a new line in the composer, the reply bar) is resized within the frame it changed in: through
  // React state the dock re-centers the glass a frame late, and the library's border/highlight layers, which
  // re-measure only on window resize, trailed behind. The section is observed for width rather than the dock,
  // whose height is set here.
  useLayoutEffect(() => {
    let last = "";
    const observer = new ResizeObserver(() => {
      const width = dock.current!.clientWidth;
      content.current!.style.width = `${width}px`;
      const height = content.current!.offsetHeight;
      if (last === `${width}x${height}`) return;
      last = `${width}x${height}`;
      dock.current!.style.height = `${height}px`;
      flushSync(() => {
        onHeight(height);
        window.dispatchEvent(new Event("resize"));
      });
    });
    observer.observe(dock.current!.parentElement!);
    observer.observe(content.current!);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={dock} className={cn("glass-dock absolute inset-x-3 z-2", className)}>
      <LiquidGlass
        className={refraction ? "" : "no-refraction"}
        style={{ position: "absolute", top: "50%", left: "50%" }}
        padding="0"
        cornerRadius={18}
        elasticity={0}
        displacementScale={48}
        blurAmount={0.25}
        saturation={160}
        aberrationIntensity={1}
      >
        {/* the library hard-codes 500 20px/1 system-ui and a text shadow on its content */}
        <div ref={content} className="bg-white/40 font-sans text-sm/[1.45] font-normal text-foreground [text-shadow:none]">
          {children}
        </div>
      </LiquidGlass>
    </div>
  );
}
