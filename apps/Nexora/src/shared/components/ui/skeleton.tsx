import { cn } from "@/shared/utils/shadcn";

// The shape of what's loading, pulsing (opacity only: composited, cheap on weak machines; still under reduced motion)
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} style={style} />;
}
