import type { RecipientState, RunState } from "@/app/bulk-send/models/bulk-send.model";

// same keys as the server's (modules/bulk-sends/services/implements/template.ts VARIABLES), which refuses others
export const VARIABLES = [
  { key: "name", label: "Tên Zalo của khách", example: "Lan Nguyễn" },
  { key: "alias", label: "Tên gợi nhớ bạn đặt", example: "Lan váy đỏ" },
  { key: "pronoun", label: "anh / chị theo giới tính", example: "chị" },
  { key: "phone", label: "Số điện thoại", example: "0912 345 678" },
  { key: "me", label: "Tên tài khoản đang gửi", example: "Shop A" },
] as const;
// what a missing value turns into
export const MISSING_AS: Record<string, string> = { pronoun: 'thành "anh/chị"' };

// the server waits 15–45 s between two sends: the estimate uses the middle
export const AVG_GAP_S = 30;

export const RUN_STATE: Record<RunState, [string, string]> = {
  running: ["Đang gửi", "bg-blue-100 text-blue-800"],
  paused: ["Tạm dừng", "bg-amber-100 text-amber-800"],
  done: ["Xong", "bg-green-100 text-green-800"],
  cancelled: ["Đã huỷ", "bg-gray-100 text-gray-600"],
};
export const RECIPIENT_STATE: Record<RecipientState, [string, string]> = {
  pending: ["Chờ", "bg-gray-100 text-gray-600"],
  sending: ["Đang gửi", "bg-blue-100 text-blue-800"],
  sent: ["Đã gửi", "bg-green-100 text-green-800"],
  failed: ["Lỗi", "bg-red-100 text-red-700"],
  unknown: ["Không rõ", "bg-violet-100 text-violet-700"],
  skipped: ["Bỏ qua", "bg-gray-100 text-gray-500"],
};
export const UNKNOWN_HINT = "Không chắc tin đã tới. Mở chat kiểm tra trước khi gửi lại";
export const BADGE = "shrink-0 rounded-full px-2 text-[11px] leading-[18px] font-semibold whitespace-nowrap";
export const MUTED = "text-xs text-muted-foreground";
