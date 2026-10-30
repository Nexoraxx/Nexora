import type { Page } from "@/app/settings/models/settings.model";
import { useSettings } from "@/app/settings/hooks/useSettings";
import { MUTED } from "@/app/settings/constants/settings.constants";
import { Section } from "@/app/settings/components/fields/settings-section";
import { Row } from "@/app/settings/components/fields/settings-row";
import { ChevronRightIcon } from "lucide-react";
import { Checkbox } from "@/shared/components/ui/checkbox";

// Zalo PC "Tin nhắn": "Tin nhắn nhanh" (with its on/off switch) and "Trả lời tự động"
export function Messages({ accountId, onPage }: { accountId: string; onPage: (p: Page) => void }) {
  const { settings: s, error, set } = useSettings(accountId);
  if (!s) return <p className={MUTED}>{error ?? "Đang tải dữ liệu"}</p>;
  const quickOn = !!s.quick_message_status;
  return (
    <>
      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
      <Section title="Tin nhắn nhanh">
        <Row label="Tin nhắn nhanh" desc="Tạo, chỉnh sửa và quản lý phím tắt cho những tin nhắn thường sử dụng trong hội thoại">
          <Checkbox checked={quickOn} title={quickOn ? undefined : "Đã ẩn tính năng. Nhấn để mở lại."} onCheckedChange={(on) => set("quick_message_status", on ? 1 : 0)} />
        </Row>
        {quickOn && (
          <Row label="Quản lý tin nhắn nhanh" onClick={() => onPage("quick")}>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </Row>
        )}
      </Section>
      <Section title="Trả lời tự động">
        <Row label="Trả lời tự động" desc="Thiết lập tin trả lời tự động để thông báo cho người khác khi bạn không thể phản hồi" onClick={() => onPage("auto")}>
          <ChevronRightIcon className="size-4 text-muted-foreground" />
        </Row>
      </Section>
    </>
  );
}
