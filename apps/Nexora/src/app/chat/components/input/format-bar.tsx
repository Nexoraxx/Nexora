import type { ReactNode } from "react";
import { BoldIcon, ItalicIcon, ListIcon, ListOrderedIcon, RemoveFormattingIcon, StrikethroughIcon, UnderlineIcon } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";

// Zalo PC's text colors and sizes; black and 15px are the defaults and send no code
const COLORS: [string, string][] = [
  ["Đen", ""],
  ["Đỏ", "db342e"],
  ["Cam", "f27806"],
  ["Vàng", "f7b503"],
  ["Xanh lá", "15a85f"],
];
const SIZES: [string, number | null][] = [
  ["Rất lớn", 20],
  ["Lớn", 18],
  ["Trung bình", null],
  ["Nhỏ", 13],
];

// Zalo PC's formatting toolbar (Ctrl + Shift + X); buttons keep the composer's focus and selection
export function FormatBar({ onApply }: { onApply: (code: string) => void }) {
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const tool = (title: string, code: string, icon: ReactNode) => (
    <Button key={code} variant="ghost" size="icon-xs" title={title} onMouseDown={keep} onClick={() => onApply(code)}>
      {icon}
    </Button>
  );
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-0.5 rounded-lg bg-white/70 dark:bg-card/80 dark:border dark:border-border/60 p-0.5">
      {tool("In đậm (Ctrl + B)", "b", <BoldIcon />)}
      {tool("In nghiêng (Ctrl + I)", "i", <ItalicIcon />)}
      {tool("Gạch chân (Ctrl + U)", "u", <UnderlineIcon />)}
      {tool("Gạch ngang chữ", "s", <StrikethroughIcon />)}
      <span className="mx-1 h-4 w-px bg-border" />
      {COLORS.map(([name, hex]) => (
        <button
          key={name}
          title={`Đổi màu chữ: ${name}`}
          className="size-4 rounded-full border"
          style={{ background: `#${hex || "050a19"}` }}
          onMouseDown={keep}
          onClick={() => onApply(`c_${hex}`)}
        />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" onMouseDown={keep}>
            Cỡ chữ
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          {SIZES.map(([name, px]) => (
            <DropdownMenuItem key={name} onSelect={() => onApply(`f_${px ?? ""}`)}>
              <span style={{ fontSize: px ?? 15 }}>{name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="mx-1 h-4 w-px bg-border" />
      {tool("Gạch đầu dòng", "lst_1", <ListIcon />)}
      {tool("Đánh số", "lst_2", <ListOrderedIcon />)}
      {tool("Bỏ tất cả định dạng", "clear", <RemoveFormattingIcon />)}
    </div>
  );
}
