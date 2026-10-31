import { useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { api } from "@/core/http/api";
import type { Account } from "@/shared/types";
import type { Preview, Template } from "@/app/bulk-send/models/bulk-send.model";
import { AVG_GAP_S, MISSING_AS, MUTED, VARIABLES } from "@/app/bulk-send/constants/bulk-send.constants";
import { duration, unknownVariables } from "@/app/bulk-send/utils/bulk-send.utils";
import { VariableTextarea } from "@/app/bulk-send/components/variable-textarea";
import { PickFriends } from "@/app/contact/components/picker/pick-friends";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { cn } from "@/shared/utils/shadcn";

const OWN = "own";
const OWN_NAME = "Tin tự soạn";

// "Tạo đợt gửi" in three steps: the text (from a template, editable for this run only), who gets it (friends of the
// sending account), and what each one will read. Starting returns at once; the server sends in the background.
export function CreateRun({ accounts, onStarted, onClose }: { accounts: Account[]; onStarted: (accountId: string, id: number) => void; onClose: () => void }) {
  const [step, setStep] = useState<"text" | "pick" | "preview">("text");
  const [accountId, setAccountId] = useState(accounts[0].id);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState(OWN);
  const [body, setBody] = useState("");
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
        onConfirm={(userIds) =>
          api<Preview>(`${base}/preview`, "POST", { body, userIds }).then((p) => (setPicked(userIds), setPreview(p), setAt(0), setNote(undefined), setStep("preview")))
        }
        onClose={() => setStep("text")}
      />
    );

  const start = () => {
    setBusy(true);
    setNote(undefined);
    api<{ id: number }>(base, "POST", { name, body, userIds: picked })
      .then((r) => onStarted(accountId, r.id))
      .catch((e) => (setNote(e.message), setBusy(false)));
  };
  const item = preview?.items[at];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[480px]">
        <DialogTitle>{step === "text" ? "Tạo đợt gửi · Nội dung" : "Tạo đợt gửi · Xem trước"}</DialogTitle>
        {step === "text" ? (
          <>
            {accounts.length > 1 && (
              <div>
                <p className={cn(MUTED, "mb-1")}>Gửi bằng tài khoản</p>
                <Select value={accountId} onValueChange={(v) => (setAccountId(v), setPicked([]))}>
                  <SelectTrigger className="w-full">
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
              <p className={cn(MUTED, "mb-1")}>Mẫu</p>
              <Select value={templateId} onValueChange={(v) => (setTemplateId(v), setBody(templates.find((t) => String(t.id) === v)?.body ?? ""))}>
                <SelectTrigger className="w-full">
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
            <div>
              <p className={cn(MUTED, "mb-1")}>Nội dung (sửa ở đây chỉ áp dụng cho đợt này)</p>
              <VariableTextarea value={body} onChange={setBody} />
            </div>
          </>
        ) : (
          preview &&
          item && (
            <>
              <div className="flex items-center justify-between">
                <Button variant="outline" size="icon-sm" disabled={at === 0} onClick={() => setAt(at - 1)}>
                  <ChevronLeftIcon />
                </Button>
                <span>
                  <b>{item.name}</b>
                  <span className={MUTED}>
                    {" "}
                    · {at + 1}/{preview.items.length}
                  </span>
                </span>
                <Button variant="outline" size="icon-sm" disabled={at === preview.items.length - 1} onClick={() => setAt(at + 1)}>
                  <ChevronRightIcon />
                </Button>
              </div>
              <div className="rounded-xl bg-blue-100 px-3 py-2 whitespace-pre-wrap">{item.text}</div>
              {Object.entries(preview.missing).map(([key, ids]) => {
                const names = ids.map((id) => preview.items.find((i) => i.userId === id)?.name).join(", ");
                return (
                  <p key={key} className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900" title={names}>
                    {ids.length} người không có {VARIABLES.find((v) => v.key === key)?.label.toLowerCase()}: <code>{`{{${key}}}`}</code> sẽ {MISSING_AS[key] ?? "để trống"}.
                  </p>
                );
              })}
              <p className="rounded-lg bg-muted px-2.5 py-1.5 text-xs">
                {preview.items.length} tin, mỗi tin cách nhau 15–45 giây: xong trong khoảng <b>{duration(preview.items.length * AVG_GAP_S)}</b>. Bạn vẫn dùng
                app bình thường trong lúc gửi, nhưng đừng thoát hẳn Nexora.
              </p>
            </>
          )
        )}
        {note && <p className="text-xs text-red-600">{note}</p>}
        <DialogFooter>
          {step === "text" ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button disabled={!body.trim() || unknownVariables(body).length > 0} onClick={() => (setNote(undefined), setStep("pick"))}>
                Chọn người nhận
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("pick")}>
                Quay lại
              </Button>
              <Button disabled={busy} onClick={start}>
                Bắt đầu gửi
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
