import { useEffect, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { api } from "@/core/http/api";
import type { OwnProfile } from "@/shared/types";
import { useSettings } from "@/app/settings/hooks/useSettings";
import { MUTED } from "@/app/settings/constants/settings.constants";
import { Section } from "@/app/settings/components/fields/settings-section";
import { Row } from "@/app/settings/components/fields/settings-row";
import { Choice } from "@/app/settings/components/fields/choice-field";
import { Checkbox } from "@/shared/components/ui/checkbox";

// Zalo PC "Quyền riêng tư", top to bottom; each change goes out alone, no confirmation
export function Privacy({ accountId, onBlockList }: { accountId: string; onBlockList: () => void }) {
  const { settings: s, error, set } = useSettings(accountId);
  const [phone, setPhone] = useState<string | null>(null);
  useEffect(() => {
    api<OwnProfile>(`/accounts/${accountId}/profile`)
      .then((p) => setPhone(p.phoneNumber))
      .catch(() => {});
  }, [accountId]);
  if (!s) return <p className={MUTED}>{error ?? "Đang tải dữ liệu"}</p>;
  const toggle = (key: string) => <Checkbox checked={!!s[key]} onCheckedChange={(on) => set(key, on ? 1 : 0)} />;

  return (
    <>
      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
      <Section title="Cá nhân">
        <Row label="Hiện ngày sinh">
          <Choice
            value={s.view_birthday}
            options={[
              [0, "Không hiện"],
              [1, "Hiện đầy đủ ngày, tháng, năm"],
              [2, "Chỉ hiện ngày, tháng"],
            ]}
            onChange={(v) => set("view_birthday", v)}
          />
        </Row>
        <Row label="Hiển thị trạng thái truy cập">{toggle("show_online_status")}</Row>
      </Section>
      <Section title="Tin nhắn và cuộc gọi">
        <Row label='Hiện trạng thái "Đã xem"'>{toggle("display_seen_status")}</Row>
        <Row label="Cho phép nhắn tin" desc="Ai được nhắn tin cho bạn">
          <Choice
            value={s.receive_message}
            options={[
              [1, "Tất cả mọi người"],
              [2, "Bạn bè"],
            ]}
            onChange={(v) => set("receive_message", v)}
          />
        </Row>
        <Row label="Cho phép gọi điện" desc="Ai được gọi điện cho bạn">
          <Choice
            value={s.accept_stranger_call}
            options={[
              [2, "Bạn bè"],
              [4, "Bạn bè và người lạ từng liên hệ"],
              [3, "Tất cả mọi người"],
            ]}
            onChange={(v) => set("accept_stranger_call", v)}
          />
        </Row>
      </Section>
      <Section title="Chặn tin nhắn">
        <Row label="Danh sách chặn" onClick={onBlockList}>
          <ChevronRightIcon className="size-4 text-muted-foreground" />
        </Row>
      </Section>
      <Section title="Nguồn tìm kiếm">
        <Row
          label={
            <>
              Cho phép người lạ tìm thấy và kết bạn qua số điện thoại{" "}
              {phone && <b>{phone.startsWith("84") ? `+(84) ${phone.slice(2)}` : phone}</b>}
            </>
          }
        >
          {toggle("add_friend_via_phone")}
        </Row>
      </Section>
      <Section title="Cho phép người lạ kết bạn">
        {(
          [
            ["add_friend_via_qr", "Mã QR của tôi"],
            ["add_friend_via_group", "Nhóm chung"],
            ["add_friend_via_contact", "Danh thiếp Zalo"],
            ["display_on_recommend_friend", 'Gợi ý "Có thể bạn quen"'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted">
            {toggle(key)} {label}
          </label>
        ))}
      </Section>
    </>
  );
}
