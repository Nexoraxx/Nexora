import type { ComponentProps } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils/shadcn";

// filled search box with a leading icon; the border only shows on focus
export function SearchInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <div className={cn("relative w-full", className)}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input placeholder="Tìm kiếm" className="border-transparent bg-muted pl-8 focus-visible:bg-background" {...props} />
    </div>
  );
}
