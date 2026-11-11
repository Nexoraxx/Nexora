import { type ComponentProps, type MouseEventHandler, useState } from "react";
import { ImageOffIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/shared/utils/shadcn";

// What stands in for a resource that can't be shown: a muted tile with an icon that says what was there, fading in
// where the skeleton was. caption: the label is written under the icon too (tiles big enough for a line of text)
export function Placeholder({
  icon: Icon = ImageOffIcon,
  label = "Không tải được",
  caption,
  className,
  onClick,
}: {
  icon?: LucideIcon;
  label?: string;
  caption?: boolean;
  className?: string;
  onClick?: MouseEventHandler;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("flex shrink-0 animate-in flex-col items-center justify-center gap-1.5 bg-muted text-muted-foreground fade-in-0 duration-300", className)}
      onClick={onClick}
    >
      <Icon className={cn("max-h-8 min-h-4 max-w-8 min-w-4 opacity-70", caption ? "size-1/4" : "size-1/3")} strokeWidth={1.5} />
      {caption && <span className="px-2 text-center text-[11px] leading-tight">{label}</span>}
    </span>
  );
}

type Props = Omit<ComponentProps<"img">, "src"> & {
  // null: known not to load (useMediaSrc failed); "" or undefined: not known yet
  src?: string | null;
  icon?: LucideIcon;
  // the placeholder's size when the image's own classes only cap it (max-h-80, ...)
  fallbackClassName?: string;
  // the placeholder writes its label under the icon
  caption?: boolean;
};

// An <img> of a remote resource: Zalo CDN links expire, get removed, or can't be decoded; a Placeholder takes its place
// While it loads (no src yet, or still downloading / decoding) its box pulses as a skeleton; once decoded it fades in.
export function Img({ src, icon, fallbackClassName, caption, className, alt = "", onError, onLoad, ...props }: Props) {
  // the src that loaded / failed, not a flag reset by an effect: a cached image's load event can come before the
  // effect runs, which would then reset it and leave the photo pulsing for good
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const [brokenSrc, setBrokenSrc] = useState<string>();
  const loaded = !!src && loadedSrc === src;
  const broken = !!src && brokenSrc === src;
  if (src === null || broken) return <Placeholder icon={icon} caption={caption} label={caption ? "Không tải được ảnh" : undefined} className={cn(className, fallbackClassName)} onClick={props.onClick as MouseEventHandler | undefined} />;
  return (
    <img
      {...props}
      src={src || undefined}
      alt={alt}
      className={cn(className, loaded ? "animate-in fade-in-0 duration-300" : "animate-pulse bg-muted")}
      onLoad={(e) => {
        setLoadedSrc(src || undefined);
        onLoad?.(e);
      }}
      onError={(e) => {
        setBrokenSrc(src || undefined);
        onError?.(e);
      }}
    />
  );
}
