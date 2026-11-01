// ponytail: fixed random gap, nobody knows Zalo's real threshold; make it a per-run choice if accounts get limited
export const MIN_GAP = 15_000
export const MAX_GAP = 45_000
// this many failures in a row pause the run: offline, kicked or Zalo refusing, going on only makes it worse
export const MAX_FAILS = 3
export const RESTARTED = 'Nexora đã khởi động lại giữa chừng'
export const NOT_FOUND = 'Không tìm thấy đợt gửi'
export const BUSY = 'Tài khoản này đang có một đợt gửi khác đang chạy'
