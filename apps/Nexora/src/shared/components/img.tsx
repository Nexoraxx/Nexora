import { type ComponentProps, type MouseEventHandler, useEffect, useState } from "react";
import { ImageOffIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/shared/utils/shadcn";

// What stands in for a resource that can't be shown: a muted tile with an icon that says what was there
export function Placeholder({ icon: Icon = ImageOffIcon, label = "Không tải được", className, onClick }: { icon?: LucideIcon; label?: string; className?: string; onClick?: MouseEventHandler }) {
  return (
    <span role="img" aria-label={label} title={label} className={cn("flex shrink-0 items-center justify-center bg-muted text-muted-foreground", className)} onClick={onClick}>
      <Icon className="size-1/3 max-h-8 min-h-4 max-w-8 min-w-4" />
    </span>
  );
}

type Props = Omit<ComponentProps<"img">, "src"> & {
  // null: known not to load (useMediaSrc failed); "" or undefined: not known yet
  src?: string | null;
  icon?: LucideIcon;
  // the placeholder's size when the image's own classes only cap it (max-h-80, ...)
  fallbackClassName?: string;
};

// An <img> of a remote resource: Zalo CDN links expire, get removed, or can't be decoded; a Placeholder takes its place
export function Img({ src, icon, fallbackClassName, className, alt = "", onError, ...props }: Props) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (src === null || broken) return <Placeholder icon={icon} className={cn(className, fallbackClassName)} onClick={props.onClick as MouseEventHandler | undefined} />;
  return (
    <img
      {...props}
      src={src || undefined}
      alt={alt}
      className={className}
      onError={(e) => {
        setBroken(true);
        onError?.(e);
      }}
    />
  );
}
