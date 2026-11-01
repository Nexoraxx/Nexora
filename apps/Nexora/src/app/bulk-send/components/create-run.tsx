import { useEffect, useState } from "react";
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  Loader2Icon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
  TagIcon,
  UsersIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { api } from "@/core/http/api";
import type { Account, ConversationSettings, Friend, Label } from "@/shared/types";
import type { Preview, Template } from "@/app/bulk-send/models/bulk-send.model";
import { MISSING_AS, MUTED, SPEEDS, VARIABLES, type Speed } from "@/app/bulk-send/constants/bulk-send.constants";
import { duration, unknownVariables } from "@/app/bulk-send/utils/bulk-send.utils";
import { VariableTextarea } from "@/app/bulk-send/components/variable-textarea";
import { Avatar } from "@/app/profile/components/avatar/user-avatar";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { cn } from "@/shared/utils/shadcn";
import { fold } from "@/shared/utils/text.utils";
import { collator } from "@/app/contact/constants/group.constants";

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

export function CreateRun({
  accounts,
  onStarted,
  onClose,
}: {
  accounts: Account[];
  onStarted: (accountId: string, id: number) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"text" | "pick" | "preview">("text");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState(OWN);
  const [body, setBody] = useState("");
  const [speed, setSpeed] = useState<Speed>("normal");

  // Recipient selection state
  const [friends, setFriends] = useState<Friend[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [selectedLabelId, setSelectedLabelId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  // Preview & execution state
  const [preview, setPreview] = useState<Preview>();
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [at, setAt] = useState(0);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Fetch templates once on mount
  useEffect(() => {
    api<Template[]>("/bulk-templates")
      .then((list) => {
        setTemplates(list);
        if (list[0]) {
          setTemplateId(String(list[0].id));
          setBody(list[0].body);
        }
      })
      .catch((e) => setNote(e.message));
  }, []);

  // Fetch friends and labels whenever accountId changes
  useEffect(() => {
    if (!accountId) return;
    setLoadingFriends(true);
    Promise.all([
      api<Friend[]>(`/accounts/${accountId}/friends`).catch(() => [] as Friend[]),
      api<ConversationSettings>(`/accounts/${accountId}/conversations`).catch(() => ({ labels: [] as Label[] })),
    ])
      .then(([friendList, convSettings]) => {
        setFriends(
          (friendList || []).sort((a, b) => collator.compare(a.alias || a.displayName, b.alias || b.displayName))
        );
        setLabels(convSettings?.labels ?? []);
      })
      .catch((e) => setNote(e.message))
      .finally(() => setLoadingFriends(false));
  }, [accountId]);

  // Keyboard navigation for preview items
  useEffect(() => {
    if (step !== "preview" || !preview?.items.length) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        setAt((prev) => Math.max(0, prev - 1));
      } else if (e.key === "ArrowRight") {
        setAt((prev) => Math.min(preview.items.length - 1, prev + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step, preview?.items.length]);

  const base = `/accounts/${accountId}/bulk-sends`;
  const name = templates.find((t) => String(t.id) === templateId)?.name ?? OWN_NAME;

  const handleAccountChange = (newId: string) => {
    setAccountId(newId);
    setPicked([]);
    setPreview(undefined);
    setAt(0);
  };

  const activeLabel = labels.find((l) => l.id === selectedLabelId);
  const labelFilteredFriends = activeLabel
    ? friends.filter((f) => activeLabel.conversations.includes(f.userId))
    : friends;

  const availableFriends = labelFilteredFriends.filter((f) => !f.isBlocked);
  const shownFriends = availableFriends.filter((f) => {
    if (!searchQuery.trim()) return true;
    const query = `${f.alias ?? ""} ${f.displayName} ${f.phoneNumber ?? ""}`;
    return fold(query).includes(fold(searchQuery.trim()));
  });

  const visibleIds = shownFriends.map((f) => f.userId);
  const selectedVisibleCount = visibleIds.filter((id) => picked.includes(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setPicked((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setPicked((prev) => [...new Set([...prev, ...visibleIds])]);
    }
  };

  const toggleFriend = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const canProceedFromStep1 = body.trim().length > 0 && unknownVariables(body).length === 0;

  const goToPreview = () => {
    if (picked.length === 0) return;
    setLoadingPreview(true);
    setNote(undefined);
    api<Preview>(`${base}/preview`, "POST", { body, userIds: picked })
      .then((p) => {
        setPreview(p);
        setAt(0);
        setStep("preview");
      })
      .catch((e) => setNote(e.message))
      .finally(() => setLoadingPreview(false));
  };

  const start = () => {
    setBusy(true);
    setNote(undefined);
    api<{ id: number }>(base, "POST", { name, body, userIds: picked, speed })
      .then((r) => onStarted(accountId, r.id))
      .catch((e) => {
        setNote(e.message);
        setBusy(false);
      });
  };

  const currentRecipient = preview?.items[at];
  const currentFriend = currentRecipient ? friends.find((f) => f.userId === currentRecipient.userId) : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-[620px] sm:max-w-[620px] h-[640px] max-h-[90vh] p-0 gap-0 overflow-hidden rounded-2xl border border-border/80 shadow-2xl bg-card flex flex-col"
      >
        {/* Unified Header */}
        <div className="flex items-center justify-between border-b px-5 py-3.5 bg-card/60 backdrop-blur-xs shrink-0">
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="text-sm font-semibold tracking-tight text-foreground">
              {step === "text" && "Soạn tin gửi hàng loạt"}
              {step === "pick" && "Chọn người nhận tin"}
              {step === "preview" && "Xem trước đợt gửi"}
            </DialogTitle>
            <p className="text-[11px] text-muted-foreground">
              {step === "text" && "Thiết lập nội dung & cấu hình tốc độ gửi"}
              {step === "pick" && "Chọn bạn bè từ danh bạ hoặc lọc theo thẻ"}
              {step === "preview" && "Kiểm tra nội dung cá nhân hóa trước khi gửi"}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Stepper Wizard */}
            <nav aria-label="Các bước gửi" className="flex items-center gap-1 text-xs">
              {/* Step 1 */}
              <button
                type="button"
                onClick={() => setStep("text")}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md transition-all font-medium cursor-pointer",
                  step === "text"
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <span
                  className={cn(
                    "size-4 rounded-full text-[10px] flex items-center justify-center font-mono font-bold shrink-0 transition-colors",
                    step === "text"
                      ? "bg-primary text-primary-foreground"
                      : step === "pick" || step === "preview"
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {step === "pick" || step === "preview" ? <CheckIcon className="size-2.5 stroke-[3]" /> : "1"}
                </span>
                <span>Nội dung</span>
              </button>

              <ChevronRightIcon className="size-3 text-muted-foreground/40 shrink-0" />

              {/* Step 2 */}
              <button
                type="button"
                disabled={!canProceedFromStep1}
                onClick={() => canProceedFromStep1 && setStep("pick")}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md transition-all font-medium",
                  step === "pick"
                    ? "bg-primary/10 text-primary font-semibold cursor-pointer"
                    : canProceedFromStep1
                    ? "text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer"
                    : "text-muted-foreground/40 cursor-not-allowed"
                )}
              >
                <span
                  className={cn(
                    "size-4 rounded-full text-[10px] flex items-center justify-center font-mono font-bold shrink-0 transition-colors",
                    step === "pick"
                      ? "bg-primary text-primary-foreground"
                      : step === "preview"
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {step === "preview" ? <CheckIcon className="size-2.5 stroke-[3]" /> : "2"}
                </span>
                <span>Người nhận</span>
                {picked.length > 0 && (
                  <span
                    className={cn(
                      "text-[10px] font-mono px-1 py-0.2 rounded-full",
                      step === "pick" ? "bg-primary/20 text-primary font-semibold" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {picked.length}
                  </span>
                )}
              </button>

              <ChevronRightIcon className="size-3 text-muted-foreground/40 shrink-0" />

              {/* Step 3 */}
              <button
                type="button"
                disabled={!preview || picked.length === 0}
                onClick={() => preview && picked.length > 0 && setStep("preview")}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md transition-all font-medium",
                  step === "preview"
                    ? "bg-primary/10 text-primary font-semibold cursor-pointer"
                    : preview && picked.length > 0
                    ? "text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer"
                    : "text-muted-foreground/40 cursor-not-allowed"
                )}
              >
                <span
                  className={cn(
                    "size-4 rounded-full text-[10px] flex items-center justify-center font-mono font-bold shrink-0 transition-colors",
                    step === "preview"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  3
                </span>
                <span>Xem trước</span>
              </button>
            </nav>

            <div className="h-4 w-px bg-border/60" />

            <button
              type="button"
              onClick={onClose}
              className="size-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              title="Đóng"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {step === "text" && (
            <div className="space-y-4">
              {accounts.length > 1 && (
                <div>
                  <p className={cn(MUTED, "mb-1.5 font-medium")}>Gửi bằng tài khoản</p>
                  <Select value={accountId} onValueChange={handleAccountChange}>
                    <SelectTrigger className="w-full h-9 rounded-xl bg-muted/20 border-border/60">
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
                <Select
                  value={templateId}
                  onValueChange={(v) => {
                    setTemplateId(v);
                    setBody(templates.find((t) => String(t.id) === v)?.body ?? "");
                    setPreview(undefined);
                  }}
                >
                  <SelectTrigger className="w-full h-9 rounded-xl bg-muted/20 border-border/60">
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
                <div className="grid grid-cols-3 gap-2.5">
                  {SPEED_OPTIONS.map((opt) => {
                    const active = speed === opt.key;
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setSpeed(opt.key)}
                        className={cn(
                          "relative flex flex-col items-start rounded-xl border p-2.5 text-left transition-all cursor-pointer select-none",
                          active
                            ? "border-primary bg-primary/8 ring-1 ring-primary/40 text-foreground shadow-xs"
                            : "border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40 text-muted-foreground hover:text-foreground active:scale-[0.98]"
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
                <div className="flex items-center justify-between mb-1.5">
                  <p className={cn(MUTED, "font-medium")}>Nội dung tin nhắn</p>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {new Blob([body]).size} / 2800 bytes
                  </span>
                </div>
                <VariableTextarea value={body} onChange={setBody} rows={5} />
              </div>
            </div>
          )}

          {step === "pick" && (
            <div className="flex flex-col h-full gap-3">
              {/* Tag / Label Filter Pills */}
              {labels.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none shrink-0">
                  <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 shrink-0 mr-0.5">
                    <TagIcon className="size-3 text-muted-foreground/70" />
                    <span>Thẻ:</span>
                  </span>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 transition-all cursor-pointer border",
                      selectedLabelId === null
                        ? "bg-primary text-primary-foreground border-primary shadow-xs"
                        : "bg-muted/40 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground"
                    )}
                    onClick={() => setSelectedLabelId(null)}
                  >
                    <span>Tất cả</span>
                    <span className={cn("text-[10px] font-mono px-1.5 py-0.2 rounded-full", selectedLabelId === null ? "bg-white/20" : "bg-muted-foreground/15")}>
                      {friends.filter((f) => !f.isBlocked).length}
                    </span>
                  </button>
                  {labels.map((l) => {
                    const count = friends.filter((f) => !f.isBlocked && l.conversations.includes(f.userId)).length;
                    const active = selectedLabelId === l.id;
                    return (
                      <button
                        key={l.id}
                        type="button"
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 transition-all cursor-pointer border",
                          active
                            ? "text-white border-transparent shadow-xs"
                            : "bg-muted/40 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground"
                        )}
                        style={active ? { backgroundColor: l.color } : undefined}
                        onClick={() => setSelectedLabelId(active ? null : l.id)}
                      >
                        <span
                          className={cn("size-2 rounded-full shrink-0 ring-1 ring-black/10", active && "bg-white")}
                          style={active ? undefined : { backgroundColor: l.color }}
                        />
                        <span className="truncate max-w-28">{l.text}</span>
                        <span className={cn("text-[10px] font-mono px-1.5 py-0.2 rounded-full", active ? "bg-white/25" : "bg-muted-foreground/15")}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Search Bar */}
              <div className="relative shrink-0">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  autoFocus
                  placeholder="Tìm kiếm bạn bè theo tên, số điện thoại..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-8 h-9 text-xs rounded-xl bg-muted/30 focus-visible:bg-background border-border/60 transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer transition-colors"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </div>

              {/* Select All Bar */}
              {shownFriends.length > 0 && (
                <div className="flex items-center justify-between rounded-xl bg-muted/40 border border-border/50 px-3 py-2 text-xs font-medium text-foreground shrink-0">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <Checkbox
                      checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                      onCheckedChange={toggleSelectAll}
                    />
                    <span>
                      {searchQuery.trim()
                        ? `Chọn tất cả kết quả tìm kiếm`
                        : activeLabel
                        ? `Chọn tất cả trong thẻ "${activeLabel.text}"`
                        : `Chọn tất cả danh sách bạn bè`}
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono font-medium text-muted-foreground bg-background px-2 py-0.5 rounded-md border border-border/60">
                      {selectedVisibleCount} / {shownFriends.length}
                    </span>
                  </div>
                </div>
              )}

              {/* Friends List */}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1 -mr-1">
                {loadingFriends ? (
                  <div className="py-14 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
                    <Loader2Icon className="size-6 animate-spin text-primary" />
                    <span>Đang tải danh bạ bạn bè...</span>
                  </div>
                ) : shownFriends.length === 0 ? (
                  <div className="py-14 text-center text-xs text-muted-foreground">
                    <UsersIcon className="size-8 mx-auto mb-2 opacity-30 stroke-[1.5]" />
                    <p className="font-medium text-foreground/80">Không tìm thấy bạn bè nào</p>
                    <p className="text-[11px] opacity-75 mt-0.5">
                      Thử đổi từ khóa tìm kiếm hoặc chọn thẻ phân loại khác
                    </p>
                  </div>
                ) : (
                  shownFriends.map((f) => {
                    const active = picked.includes(f.userId);
                    const name = f.alias || f.displayName;
                    return (
                      <label
                        key={f.userId}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-2 transition-all cursor-pointer select-none border",
                          active
                            ? "bg-primary/6 border-primary/25 text-foreground shadow-2xs"
                            : "border-transparent hover:border-border/60 hover:bg-muted/40 active:scale-[0.99]"
                        )}
                      >
                        <Checkbox checked={active} onCheckedChange={() => toggleFriend(f.userId)} />
                        <Avatar src={f.avatar} name={name} size={36} />
                        <div className="min-w-0 flex-1">
                          <span className="truncate text-xs font-medium text-foreground block">{name}</span>
                          {f.phoneNumber && (
                            <span className="text-[11px] text-muted-foreground font-mono block">{f.phoneNumber}</span>
                          )}
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {step === "preview" && preview && currentRecipient && (
            <div className="flex flex-col h-full gap-3">
              {/* Recipient Navigator */}
              <div className="flex items-center justify-between rounded-xl bg-muted/40 border border-border/50 px-3.5 py-2.5 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar src={currentFriend?.avatar} name={currentRecipient.name} size={34} />
                  <div className="min-w-0 truncate">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-foreground truncate">{currentRecipient.name}</span>
                      {currentFriend?.phoneNumber && (
                        <span className="text-[11px] font-mono text-muted-foreground">{currentFriend.phoneNumber}</span>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground block truncate">Người nhận #{at + 1}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-mono font-medium text-muted-foreground bg-background px-2.5 py-1 rounded-lg border border-border/60">
                    {at + 1} / {preview.items.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon-xs"
                      disabled={at === 0}
                      onClick={() => setAt((prev) => prev - 1)}
                      className="size-7 cursor-pointer"
                      title="Người trước (Phím mũi tên trái)"
                    >
                      <ChevronLeftIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      disabled={at === preview.items.length - 1}
                      onClick={() => setAt((prev) => prev + 1)}
                      className="size-7 cursor-pointer"
                      title="Người tiếp theo (Phím mũi tên phải)"
                    >
                      <ChevronRightIcon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Personalized Message Bubble */}
              <div className="space-y-1.5 shrink-0">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground">Nội dung tin nhắn thực tế:</span>
                  <span className="text-[11px] text-muted-foreground font-mono">{new Blob([currentRecipient.text]).size} bytes</span>
                </div>
                <div className="relative rounded-2xl rounded-tl-sm bg-primary/8 border border-primary/20 p-4 text-[13px] leading-relaxed shadow-xs text-foreground whitespace-pre-wrap select-text max-h-[170px] overflow-y-auto">
                  {currentRecipient.text}
                </div>
              </div>

              {/* Missing Variables Warnings */}
              {Object.keys(preview.missing).length > 0 && (
                <div className="space-y-2 shrink-0">
                  {Object.entries(preview.missing).map(([key, ids]) => {
                    const names = ids.map((id) => preview.items.find((i) => i.userId === id)?.name || id).slice(0, 3).join(", ");
                    const more = ids.length > 3 ? ` và ${ids.length - 3} người khác` : "";
                    return (
                      <div key={key} className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                        <AlertCircleIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                        <div className="flex-1 leading-relaxed">
                          <p>
                            <strong className="font-semibold">{ids.length} người</strong> ({names}{more}) không có dữ liệu cho biến <code className="bg-amber-500/15 px-1.5 py-0.5 rounded text-[11px] font-mono">{`{{${key}}}`}</code> ({VARIABLES.find((v) => v.key === key)?.label.toLowerCase()}): hệ thống sẽ {MISSING_AS[key] ?? "để trống"}.
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Run Configuration Summary Card */}
              <div className="mt-auto shrink-0 flex items-start gap-3 rounded-xl bg-muted/40 border border-border/60 p-3.5 text-xs">
                <ClockIcon className="size-4 shrink-0 text-primary mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground">{preview.items.length} tin nhắn</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">Tốc độ:</span>
                    <span className="font-semibold text-primary">{SPEEDS[speed].label}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">Dự kiến xong:</span>
                    <span className="font-mono font-semibold text-foreground">
                      {duration(preview.items.length * SPEEDS[speed].avgGap)}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    Hệ thống sẽ gửi ngầm từng tin theo khoảng nghỉ ngẫu nhiên. Bạn vẫn dùng ứng dụng bình thường trong lúc gửi.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Inline Error Note if any */}
        {note && (
          <div className="px-5 py-2 bg-destructive/10 border-t border-destructive/20 text-xs text-destructive shrink-0">
            {note}
          </div>
        )}

        {/* Unified Dialog Footer */}
        <div className="flex items-center justify-between border-t bg-muted/20 px-5 py-3 shrink-0">
          {step === "text" && (
            <>
              <Button variant="outline" size="sm" onClick={onClose} className="cursor-pointer">
                Hủy
              </Button>
              <Button
                size="sm"
                disabled={!canProceedFromStep1}
                onClick={() => {
                  setNote(undefined);
                  setStep("pick");
                }}
                className="font-medium gap-1.5 cursor-pointer"
              >
                <span>Chọn người nhận</span>
                <ChevronRightIcon className="size-3.5" />
              </Button>
            </>
          )}

          {step === "pick" && (
            <>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => setStep("text")} className="gap-1 cursor-pointer">
                  <ChevronLeftIcon className="size-3.5" />
                  <span>Quay lại</span>
                </Button>
                {picked.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPicked([])}
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                  >
                    Bỏ chọn tất cả ({picked.length})
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground cursor-pointer">
                  Hủy
                </Button>
                <Button
                  size="sm"
                  disabled={picked.length === 0 || loadingPreview}
                  onClick={goToPreview}
                  className="font-medium gap-1.5 cursor-pointer"
                >
                  {loadingPreview && <Loader2Icon className="size-3.5 animate-spin" />}
                  <span>Xem trước ({picked.length})</span>
                  <ChevronRightIcon className="size-3.5" />
                </Button>
              </div>
            </>
          )}

          {step === "preview" && (
            <>
              <Button variant="outline" size="sm" onClick={() => setStep("pick")} className="gap-1 cursor-pointer">
                <ChevronLeftIcon className="size-3.5" />
                <span>Quay lại chọn người</span>
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground cursor-pointer">
                  Hủy
                </Button>
                <Button
                  size="sm"
                  disabled={busy || !preview?.items.length}
                  onClick={start}
                  className="font-medium gap-1.5 cursor-pointer"
                >
                  {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : <SendIcon className="size-3.5" />}
                  <span>Bắt đầu gửi</span>
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
