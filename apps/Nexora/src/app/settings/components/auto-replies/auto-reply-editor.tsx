import { useState } from "react";
import type { AutoReply } from "@/shared/types";
import { PickFriends } from "@/app/contact/components/picker/pick-friends";
import { H, MIN, DAY, MUTED } from "@/app/settings/constants/auto-reply.constants";
import { windowOf, timeOfDay, hhmm } from "@/app/settings/utils/auto-reply.utils";
import { Chip } from "@/app/settings/components/auto-replies/chip";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils/shadcn";

const MAX_CONTENT = 2000;

// Zalo PC's ranges: "Cả ngày", 12:00 đến 13:30, 18:00 đến 07:30 (a window is times of day; equal = the whole day)
const PRESETS: [number, number][] = [
  [0, 0],
  [12 * H, 13.5 * H],
  [18 * H, 7.5 * H],
];
const SCOPES: [number, string, string][] = [
  [0, "Tất cả mọi người", "Trả lời tất cả bạn bè và người lạ"],
  [1, "Người lạ", "Trả lời những người chưa là bạn bè"],
  [3, "Bạn bè ngoại trừ ...", "Trả lời cho tất cả bạn bè, trừ một số người"],
  [2, "Bạn bè cụ thể ...", "Chỉ trả lời cho một số bạn bè được lựa chọn"],
];

const fromHhmm = (s: string) => Number(s.slice(0, 2)) * H + Number(s.slice(3, 5)) * MIN;

type Form = { content: string; start: number; end: number; scope: number; uids: string[] };

// PC's editor: content, the time window (a preset or two times), who gets the reply; a new rule's window starts 10
// minutes from now and lasts until an hour from now
export function AutoReplyEditor({ accountId, rule, onSave, onClose }: { accountId: string; rule?: AutoReply; onSave: (f: Form) => Promise<unknown>; onClose: () => void }) {
  const [form, setForm] = useState<Form>(() => {
    if (rule) return { content: rule.content, ...windowOf(rule), scope: rule.scope, uids: rule.uids };
    const now = timeOfDay(Math.floor(Date.now() / MIN) * MIN);
    return { content: "", start: (now + 10 * MIN) % DAY, end: (now + H) % DAY, scope: 0, uids: [] };
  });
  const [custom, setCustom] = useState(!PRESETS.some(([s, e]) => s === form.start && e === form.end));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const valid = form.content.trim() && (form.scope !== 2 || form.uids.length > 0);

  const save = () => {
    setBusy(true);
    setError(undefined);
    onSave(form).catch((e) => (setError(e.message), setBusy(false)));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-h-[90vh] w-[480px] overflow-y-auto">
        <DialogTitle>{rule ? "Chỉnh sửa tin trả lời tự động" : "Tạo mới tin trả lời tự động"}</DialogTitle>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ar-content">Nội dung tin</Label>
          <Textarea
            id="ar-content"
            rows={4}
            maxLength={MAX_CONTENT}
            placeholder="Nhập nội dung tin nhắn (VD: Mình đang trong giờ nghỉ trưa, …)"
            value={form.content}
            onChange={(e) => set({ content: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Gửi trả lời trong khoảng thời gian</Label>
          <div className="flex flex-wrap gap-1.5">
            <Chip on={custom} onClick={() => setCustom(true)}>
              Tùy chọn
            </Chip>
            {PRESETS.map(([s, e]) => (
              <Chip key={s} on={!custom && form.start === s && form.end === e} onClick={() => (setCustom(false), set({ start: s, end: e }))}>
                {s === e ? "Cả ngày" : `${hhmm(s)} đến ${hhmm(e)}`}
              </Chip>
            ))}
          </div>
          {custom && (
            <div className="flex items-center gap-2">
              <span className={MUTED}>Chọn thời gian gửi trả lời</span>
              <Input type="time" className="w-28" value={hhmm(form.start)} onChange={(e) => e.target.value && set({ start: fromHhmm(e.target.value) })} />
              Đến
              <Input type="time" className="w-28" value={hhmm(form.end)} onChange={(e) => e.target.value && set({ end: fromHhmm(e.target.value) })} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Gửi trả lời khi nhận được tin nhắn từ:</Label>
          <RadioGroup value={String(form.scope)} onValueChange={(v) => set({ scope: Number(v) })}>
            {SCOPES.map(([id, label, desc]) => (
              <Label key={id} className="items-start py-1 font-normal">
                <RadioGroupItem value={String(id)} className="mt-0.5" />
                <span>
                  {label}
                  <span className={cn(MUTED, "block")}>{desc}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
          {form.scope >= 2 && (
            <Button variant="outline" className="self-start" onClick={() => setPicking(true)}>
              Chọn bạn bè ({form.uids.length})
            </Button>
          )}
        </div>
        {!form.content.trim() && <p className="text-xs text-muted-foreground">Nội dung không được để trống.</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!valid || busy} onClick={save}>
            Lưu
          </Button>
        </DialogFooter>
        {picking && (
          <PickFriends
            accountId={accountId}
            title={form.scope === 2 ? "Bạn bè cụ thể" : "Bạn bè ngoại trừ"}
            confirm="Xác nhận"
            min={form.scope === 2 ? 1 : 0}
            initial={form.uids}
            onConfirm={async (uids) => (set({ uids: uids.slice(0, 50) }), setPicking(false))}
            onClose={() => setPicking(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
