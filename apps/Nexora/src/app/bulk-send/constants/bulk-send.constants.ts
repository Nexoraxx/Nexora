import type { RecipientState, RunState } from "@/app/bulk-send/models/bulk-send.model";

// same keys as the server's (modules/bulk-sends/services/implements/template.ts VARIABLES), which refuses others
// example: what the sample customer (SAMPLE) gets; note: what to know before using it
export const VARIABLES = [
  { key: "name", label: "Tên Zalo của khách", example: "Nguyễn Thị Lan", note: "tên khách tự đặt trên Zalo" },
  { key: "alias", label: "Tên gợi nhớ bạn đặt", example: "Lan váy đỏ", note: "chưa đặt thì dùng tên Zalo" },
  { key: "pronoun", label: "Xưng hô theo giới tính", example: "chị", note: "nam: anh, nữ: chị, không rõ: anh/chị" },
  { key: "phone", label: "Số điện thoại", example: "0912 345 678", note: "trống nếu khách ẩn số" },
  { key: "me", label: "Tên tài khoản đang gửi", example: "Shop A", note: "tên Zalo của bạn" },
] as const;
// {{key | filter}}: same as the server's (modules/bulk-sends/helpers/template.helper.ts), which refuses others.
// Shown as "you write → the customer reads" for one sample customer (SAMPLE). insert: what a click adds; key: the
// variable a click starts when the caret isn't on one
export const SAMPLE = "Nguyễn Thị Lan, nữ";
export const FILTER_GROUPS = [
  {
    title: "Viết hoa, viết thường",
    rows: [
      { insert: "cap", label: "Viết hoa chữ đầu", key: "pronoun", write: "{{pronoun | cap}}", result: "Chị", note: "viết hoa chữ đầu, hợp để mở đầu câu" },
      { insert: "upper", label: "Viết hoa tất cả", key: "name", write: "{{name | upper}}", result: "NGUYỄN THỊ LAN", note: "viết hoa tất cả" },
      { insert: "title", label: "Viết hoa đầu mỗi chữ", key: "name", write: "{{name | title}}", result: "Nguyễn Thị Lan", note: "viết hoa đầu mỗi chữ, kể cả khi tên Zalo viết thường" },
      { insert: "lower", label: "Viết thường tất cả", key: "name", write: "{{name | lower}}", result: "nguyễn thị lan", note: "viết thường tất cả" },
    ],
  },
  {
    title: "Chỉ lấy một phần của tên",
    rows: [
      { insert: "last", label: "Chỉ lấy tên gọi", key: "name", write: "{{name | last}}", result: "Lan", note: "chữ cuối, thường là tên gọi" },
      { insert: "first", label: "Chỉ lấy chữ đầu", key: "name", write: "{{name | first}}", result: "Nguyễn", note: "chữ đầu tiên" },
    ],
  },
  {
    title: "Xưng hô theo giới tính",
    rows: [
      { insert: "ông/bà", label: "Xưng ông / bà", key: "pronoun", write: "{{pronoun | ông/bà}}", result: "bà", note: "khách nam ra ông, nữ ra bà, không rõ ra ông/bà" },
      { insert: "cô/chú", label: "Cặp xưng hô khác", key: "pronoun", write: "{{pronoun | cô/chú}}", result: "cô", note: "cô/chú hay chú/cô đều hiểu; cặp lạ thì chữ trước cho nam" },
    ],
  },
  {
    title: "Khi khách thiếu thông tin",
    rows: [{ insert: "or:chưa có số", label: "Chữ thay khi trống", key: "phone", write: "{{phone | or:chưa có số}}", result: "chưa có số", note: "khách không có số điện thoại thì dùng chữ này" }],
  },
] as const;
// the case and word filters by name; "or:…" and "nam/nữ" pairs are shapes
export const CASE_FILTERS = ["upper", "lower", "cap", "title", "first", "last"];

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
