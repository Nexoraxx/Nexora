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

export type Speed = "fast" | "normal" | "safe";

export const SPEEDS: Record<Speed, { label: string; minGap: number; maxGap: number; avgGap: number; tip: string }> = {
  fast: { label: "Nhanh (3–6s)", minGap: 3000, maxGap: 6000, avgGap: 4.5, tip: "Nhanh nhất (khoảng 3–6 giây / tin)" },
  normal: { label: "Vừa (6–12s)", minGap: 6000, maxGap: 12000, avgGap: 9, tip: "Cân bằng tốc độ và an toàn (Khuyên dùng)" },
  safe: { label: "An toàn (15–30s)", minGap: 15000, maxGap: 30000, avgGap: 22.5, tip: "Chậm, hạn chế rủi ro Zalo quét spam" },
};

// default estimate uses the normal speed
export const AVG_GAP_S = SPEEDS.normal.avgGap;

export const RUN_STATE: Record<RunState, [string, string]> = {
  running: ["Đang gửi", "bg-primary/10 text-primary border-primary/20"],
  paused: ["Tạm dừng", "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"],
  done: ["Xong", "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"],
  cancelled: ["Đã huỷ", "bg-muted text-muted-foreground border-border/50"],
};
export const RECIPIENT_STATE: Record<RecipientState, [string, string]> = {
  pending: ["Chờ", "bg-muted text-muted-foreground border-border/50"],
  sending: ["Đang gửi", "bg-primary/10 text-primary border-primary/20"],
  sent: ["Đã gửi", "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"],
  failed: ["Lỗi", "bg-destructive/10 text-destructive border-destructive/20"],
  unknown: ["Không rõ", "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"],
  skipped: ["Bỏ qua", "bg-muted text-muted-foreground/80 border-border/50"],
};
export const UNKNOWN_HINT = "Không chắc tin đã tới. Mở chat kiểm tra trước khi gửi lại";
export const BADGE = "shrink-0 rounded-full px-2 py-0.5 text-[10px] leading-tight font-medium whitespace-nowrap border";
export const MUTED = "text-xs text-muted-foreground";
