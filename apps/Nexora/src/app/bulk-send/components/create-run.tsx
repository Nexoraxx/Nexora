import { useEffect, useState } from "react";
import { AlertCircleIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, ShieldCheckIcon, ZapIcon } from "lucide-react";
import { api } from "@/core/http/api";
import type { Account } from "@/shared/types";
import type { Preview, Template } from "@/app/bulk-send/models/bulk-send.model";
import { MISSING_AS, MUTED, SPEEDS, VARIABLES, type Speed } from "@/app/bulk-send/constants/bulk-send.constants";
import { duration, unknownVariables } from "@/app/bulk-send/utils/bulk-send.utils";
import { VariableTextarea } from "@/app/bulk-send/components/variable-textarea";
import { PickFriends } from "@/app/contact/components/picker/pick-friends";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { cn } from "@/shared/utils/shadcn";

const OWN = "own";
const OWN_NAME = "Tin tự soạn";

const SPEED_OPTIONS: {
  key: Speed;
  title: string;
  icon: typeof ZapIcon;
  gap: string;
  desc: string;
  color: string;
  badge?: string;
}[] = [
  { key: "fast", title: "Nhanh", icon: ZapIcon, gap: "3–6 giây", desc: "Nhanh nhất", color: "text-amber-500" },
  { key: "normal", title: "Vừa", icon: ClockIcon, gap: "6–12 giây", desc: "Khuyên dùng", color: "text-primary", badge: "Khuyên dùng" },
  { key: "safe", title: "An toàn", icon: ShieldCheckIcon, gap: "15–30 giây", desc: "Hạn chế spam", color: "text-emerald-500" },
];

// "Tạo đợt gửi" in three steps: the text (from a template, editable for this run only), who gets it (friends of the
// sending account), and what each one will read. Starting returns at once; the server sends in the background.
export function CreateRun({ accounts, onStarted, onClose }: { accounts: Account[]; onStarted: (accountId: string, id: number) => void; onClose: () => void }) {
  const [step, setStep] = useState<"text" | "pick" | "preview">("text");
  const [accountId, setAccountId] = useState(accounts[0].id);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState(OWN);
  const [body, setBody] = useState("");
  const [speed, setSpeed] = useState<Speed>("normal");
  const [picked, setPicked] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview>();
  const [at, setAt] = useState(0);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Template[]>("/bulk-templates")
      .then((list) => {
        setTemplates(list);
        if (list[0]) (setTemplateId(String(list[0].id)), setBody(list[0].body));
      })
      .catch((e) => setNote(e.message));
  }, []);
  const base = `/accounts/${accountId}/bulk-sends`;
  const name = templates.find((t) => String(t.id) === templateId)?.name ?? OWN_NAME;

  if (step === "pick")
    return (
      <PickFriends
        key={accountId}
        accountId={accountId}
        title="Chọn người nhận"
        confirm="Xem trước"
        initial={picked}
        selectAll
        skipBlocked
        filterLabels
        onConfirm={(userIds) =>
          api<Preview>(`${base}/preview`, "POST", { body, userIds }).then((p) => (setPicked(userIds), setPreview(p), setAt(0), setNote(undefined), setStep("preview")))
        }
        onClose={() => setStep("text")}
      />
    );

  const start = () => {
    setBusy(true);
    setNote(undefined);
    api<{ id: number }>(base, "POST", { name, body, userIds: picked, speed })
      .then((r) => onStarted(accountId, r.id))
      .catch((e) => (setNote(e.message), setBusy(false)));
  };
  const item = preview?.items[at];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[500px] sm:max-w-[500px] gap-4 p-5">
        <div className="flex items-center justify-between border-b pb-3 -mt-1">
          <DialogTitle className="text-sm font-semibold tracking-tight text-foreground">
            {step === "text" ? "Soạn tin gửi hàng loạt" : "Xem trước tin gửi"}
          </DialogTitle>
          <div className="flex items-center gap-1.5 text-xs">
            <span className={cn("flex items-center gap-1 font-medium", step === "text" ? "text-primary" : "text-muted-foreground")}>
              <span className={cn("size-4 rounded-full text-[10px] flex items-center justify-center font-mono font-bold", step === "text" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>1</span>
              <span>Nội dung</span>
            </span>
            <ChevronRightIcon className="size-3 text-muted-foreground/40" />
            <span className="flex items-center gap-1 text-muted-foreground">
              <span className="size-4 rounded-full text-[10px] flex items-center justify-center font-mono font-bold bg-muted text-muted-foreground">2</span>
              <span>Người nhận</span>
            </span>
            <ChevronRightIcon className="size-3 text-muted-foreground/40" />
            <span className={cn("flex items-center gap-1 font-medium", step === "preview" ? "text-primary" : "text-muted-foreground")}>
              <span className={cn("size-4 rounded-full text-[10px] flex items-center justify-center font-mono font-bold", step === "preview" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>3</span>
              <span>Xem trước</span>
            </span>
          </div>
        </div>

        {step === "text" ? (
          <div className="space-y-3.5">
            {accounts.length > 1 && (
              <div>
                <p className={cn(MUTED, "mb-1.5 font-medium")}>Gửi bằng tài khoản</p>
                <Select value={accountId} onValueChange={(v) => (setAccountId(v), setPicked([]))}>
                  <SelectTrigger className="w-full h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <p className={cn(MUTED, "mb-1.5 font-medium")}>Mẫu tin nhắn</p>
              <Select value={templateId} onValueChange={(v) => (setTemplateId(v), setBody(templates.find((t) => String(t.id) === v)?.body ?? ""))}>
                <SelectTrigger className="w-full h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={OWN}>{OWN_NAME}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className={cn(MUTED, "font-medium")}>Tốc độ gửi từng tin</span>
                <span className="text-[11px] text-muted-foreground">Khoảng nghỉ ngẫu nhiên</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {SPEED_OPTIONS.map((opt) => {
                  const active = speed === opt.key;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setSpeed(opt.key)}
                      className={cn(
                        "relative flex flex-col items-start rounded-xl border p-2.5 text-left transition-all cursor-pointer",
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary/40 text-foreground shadow-xs"
                          : "border-border/60 bg-card hover:border-border hover:bg-muted/40 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {opt.badge && (
                        <span className="absolute -top-2 right-2 rounded-full bg-primary px-1.5 py-0.2 text-[9px] font-semibold text-primary-foreground tracking-tight shadow-xs">
                          {opt.badge}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon className={cn("size-3.5 shrink-0", active ? opt.color : "text-muted-foreground")} />
                        <span className={cn("text-xs font-semibold", active ? "text-foreground" : "text-foreground/80")}>
                          {opt.title}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono font-medium text-foreground/90">{opt.gap}</span>
                      <span className="text-[10px] text-muted-foreground mt-0.5 truncate w-full">{opt.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className={cn(MUTED, "mb-1.5 font-medium")}>Nội dung tin nhắn</p>
              <VariableTextarea value={body} onChange={setBody} />
            </div>
          </div>
        ) : (
          preview &&
          item && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-muted/40 border border-border/50 px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="size-7 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                    {item.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 truncate">
                    <span className="font-semibold text-xs text-foreground truncate block">{item.name}</span>
                    <span className="text-[11px] text-muted-foreground">Người nhận</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-mono text-muted-foreground bg-background px-2 py-0.5 rounded border border-border/60">
                    {at + 1} / {preview.items.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon-xs" disabled={at === 0} onClick={() => setAt(at - 1)} className="size-7">
                      <ChevronLeftIcon className="size-3.5" />
                    </Button>
                    <Button variant="outline" size="icon-xs" disabled={at === preview.items.length - 1} onClick={() => setAt(at + 1)} className="size-7">
                      <ChevronRightIcon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="relative rounded-2xl rounded-tl-sm bg-primary/8 border border-primary/15 p-3.5 text-[13px] leading-relaxed shadow-xs text-foreground whitespace-pre-wrap">
                {item.text}
              </div>

              {Object.entries(preview.missing).map(([key, ids]) => {
                const names = ids.map((id) => preview.items.find((i) => i.userId === id)?.name).join(", ");
                return (
                  <div key={key} className="flex items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50/70 p-2.5 text-xs text-amber-900" title={names}>
                    <AlertCircleIcon className="size-4 shrink-0 text-amber-600 mt-0.5" />
                    <p className="flex-1">
                      <span className="font-semibold">{ids.length} người</span> không có dữ liệu cho <code className="bg-amber-100/80 px-1 py-0.5 rounded text-[11px] font-mono">{`{{${key}}}`}</code> ({VARIABLES.find((v) => v.key === key)?.label.toLowerCase()}): sẽ {MISSING_AS[key] ?? "để trống"}.
                    </p>
                  </div>
                );
              })}

              <div className="flex items-start gap-3 rounded-xl bg-muted/60 border border-border/60 p-3 text-xs">
                <ClockIcon className="size-4 shrink-0 text-primary mt-0.5" />
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground">{preview.items.length} tin nhắn</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">Tốc độ:</span>
                    <span className="font-semibold text-primary">{SPEEDS[speed].label}</span>
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    Dự kiến xong trong khoảng <b className="text-foreground font-semibold font-mono">{duration(preview.items.length * SPEEDS[speed].avgGap)}</b>. Bạn vẫn dùng app bình thường trong lúc gửi.
                  </p>
                </div>
              </div>
            </div>
          )
        )}
        {note && <p className="text-xs text-destructive bg-destructive/10 px-2.5 py-1.5 rounded-lg">{note}</p>}
        <DialogFooter className="border-t pt-3">
          {step === "text" ? (
            <>
              <Button variant="outline" size="sm" onClick={onClose}>
                Hủy
              </Button>
              <Button size="sm" disabled={!body.trim() || unknownVariables(body).length > 0} onClick={() => (setNote(undefined), setStep("pick"))}>
                Chọn người nhận
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setStep("pick")}>
                Quay lại
              </Button>
              <Button size="sm" disabled={busy} onClick={start}>
                Bắt đầu gửi
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
