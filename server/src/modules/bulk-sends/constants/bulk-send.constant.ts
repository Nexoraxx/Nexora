export const SPEEDS = {
  fast: { minGap: 3_000, maxGap: 6_000, avgGap: 4.5 },
  normal: { minGap: 6_000, maxGap: 12_000, avgGap: 9 },
  safe: { minGap: 15_000, maxGap: 30_000, avgGap: 22.5 },
} as const
export type Speed = keyof typeof SPEEDS

export const MIN_GAP = SPEEDS.normal.minGap
export const MAX_GAP = SPEEDS.normal.maxGap
// this many failures in a row pause the run: offline, kicked or Zalo refusing, going on only makes it worse
export const MAX_FAILS = 3
export const RESTARTED = 'Nexora đã khởi động lại giữa chừng'
export const NOT_FOUND = 'Không tìm thấy đợt gửi'
export const BUSY = 'Tài khoản này đang có một đợt gửi khác đang chạy'
