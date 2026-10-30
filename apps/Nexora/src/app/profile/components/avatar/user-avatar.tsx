import { Avatar as AvatarRoot, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar";

// the initial shows while the image loads and when it fails
export function Avatar({ src, name, size }: { src?: string | null; name: string; size: number }) {
  return (
    <AvatarRoot style={{ width: size, height: size }}>
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback className="bg-blue-200 font-semibold text-blue-900" style={{ fontSize: size * 0.4 }}>
        {name.trim()[0]?.toUpperCase() ?? "?"}
      </AvatarFallback>
    </AvatarRoot>
  );
}
