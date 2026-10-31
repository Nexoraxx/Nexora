import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { COMPOSER_BAR, COMPOSER_TOOLS, MESSAGE_BAR, MESSAGE_TOOLS, VIEW_BAR, VIEW_TOOLS } from "@/app/chat/constants/toolbar.constants";
import { arrange, edit, saveLayout, useLayout, type Place, type Tool } from "@/shared/hooks/use-toolbar";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";

const GROUPS: [Place, string][] = [
  ["bar", "Hiện trên thanh"],
  ["menu", "Gom vào menu Thêm"],
  ["hidden", "Ẩn"],
];

function BarEditor({ bar, title, tools }: { bar: string; title: string; tools: Tool[] }) {
  const layout = useLayout(bar);
  const list = arrange(tools, layout);
  const set = (id: string, change: { place?: Place; move?: -1 | 1 }) => saveLayout(bar, edit(tools, layout, id, change));
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="font-semibold">{title}</h4>
        {layout && (
          <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => saveLayout(bar, null)}>
            Khôi phục mặc định
          </Button>
        )}
      </div>
      {GROUPS.map(([place, label]) => {
        const rows = list.filter((t) => t.place === place);
        return (
          <div key={place} className="mb-3 last:mb-0">
            <div className="mb-1 text-xs text-muted-foreground">{label}</div>
            <div className="divide-y rounded-lg border">
              {rows.map((t, k) => (
                <div key={t.id} className="flex items-center gap-2.5 py-1 pr-1.5 pl-3">
                  <t.icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                  {place !== "hidden" && (
                    <>
                      <Button variant="ghost" size="icon-xs" title="Đưa lên" disabled={k === 0} onClick={() => set(t.id, { move: -1 })}>
                        <ChevronUpIcon />
                      </Button>
                      <Button variant="ghost" size="icon-xs" title="Đưa xuống" disabled={k === rows.length - 1} onClick={() => set(t.id, { move: 1 })}>
                        <ChevronDownIcon />
                      </Button>
                    </>
                  )}
                  <Select value={t.place} onValueChange={(p) => set(t.id, { place: p as Place })}>
                    <SelectTrigger size="sm" className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GROUPS.filter(([value]) => !t.places || t.places.includes(value)).map(([value, text]) => (
                        <SelectItem key={value} value={value}>
                          {text}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {!rows.length && <div className="px-3 py-2 text-xs text-muted-foreground">Không có công cụ nào</div>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

// every customizable toolbar; changes apply at once and stay on this device
export function ToolbarEditor() {
  return (
    <>
      <BarEditor bar={VIEW_BAR} title="Thanh trên cùng (Tin nhắn, Danh bạ…)" tools={VIEW_TOOLS} />
      <BarEditor bar={COMPOSER_BAR} title="Ô soạn tin" tools={COMPOSER_TOOLS} />
      <BarEditor bar={MESSAGE_BAR} title="Khi rê chuột lên tin nhắn" tools={MESSAGE_TOOLS} />
    </>
  );
}

export function ToolbarDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[85vh] w-[560px] max-w-[95vw] flex-col gap-0 p-0 sm:max-w-[560px]">
        <DialogTitle className="border-b px-5 py-4">Tùy chỉnh thanh công cụ</DialogTitle>
        <div className="overflow-y-auto p-5">
          <ToolbarEditor />
        </div>
      </DialogContent>
    </Dialog>
  );
}
