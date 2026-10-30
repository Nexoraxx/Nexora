import { useState } from "react";
import { api } from "@/core/http/api";
import type { UserProfile } from "@/shared/types";
import { ReportDone } from "@/app/profile/components/report/report-done";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import { Textarea } from "@/shared/components/ui/textarea";

// Zalo PC takes the reason texts from the server's abuse_config, which zca doesn't keep: these are PC's own labels for
// the codes, in its report_v2.reason_obj order; 0 = "Vấn đề khác" (max_other_reason_length 1000)
const REASONS: [number, string][] = [
  [1, "Nội dung nhạy cảm"],
  [2, "Làm phiền"],
  [3, "Lừa đảo"],
  [0, "Vấn đề khác"],
];
const MAX = 1000;

// "Báo xấu": a reason, with a description for "Vấn đề khác". A user then gets PC's done screen, which offers to block
// them and, for a friend, to remove them; a group just reports.
export function Report({
  accountId,
  targetId,
  name,
  user,
  onDone,
}: {
  accountId: string;
  targetId: string;
  name: string;
  // set for a user, absent for a group
  user?: UserProfile;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<number>();
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const base = `/accounts/${accountId}`;

  const submit = () => {
    setBusy(true);
    setError(undefined);
    api(`${base}/${user ? "users" : "groups"}/${targetId}/report`, "POST", { reason, content })
      .then(() => setSent(true), (e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (sent)
    return user ? (
      <ReportDone accountId={accountId} user={user} name={name} onDone={onDone} />
    ) : (
      <div className="flex flex-col gap-3 px-4 pt-2 pb-4">
        <p>Báo xấu thành công</p>
        <Button className="self-end" onClick={onDone}>
          Hoàn tất
        </Button>
      </div>
    );

  return (
    <form
      className="flex flex-col gap-3 px-4 pt-2 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p>
        {user ? "Chọn lý do báo xấu tài khoản" : "Bạn lo ngại về hội thoại này, chọn một trong những lý do dưới đây rồi gửi cho chúng tôi."}{" "}
        {user && <b>{name}</b>}
      </p>
      <RadioGroup value={reason === undefined ? "" : String(reason)} onValueChange={(v) => setReason(Number(v))}>
        {REASONS.map(([id, label]) => (
          <Label key={id} className="py-1 font-normal">
            <RadioGroupItem value={String(id)} /> {label}
          </Label>
        ))}
      </RadioGroup>
      {reason === 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-content">Nhập mô tả để tiếp tục</Label>
          <Textarea
            id="report-content"
            autoFocus
            className="h-30"
            maxLength={MAX}
            placeholder="Nhập lý do báo xấu"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <span className="self-end text-xs text-muted-foreground">
            {content.length}/{MAX}
          </span>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button type="submit" className="self-end" disabled={reason === undefined || (reason === 0 && !content.trim()) || busy}>
        Báo xấu
      </Button>
    </form>
  );
}
