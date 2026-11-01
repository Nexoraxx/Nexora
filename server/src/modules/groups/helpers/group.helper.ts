// PC's lists of names: "An", "An và Bình", "An và 3 người khác"
export const who = (names: string[]) => (names.length > 2 ? `${names[0]} và ${names.length - 1} người khác` : names.join(' và '))

// PC's _getInviteErrorText and invite summary, per error code of invite/v2's error_data
export function inviteError(code: number, names: string[]) {
  const n = who(names)
  switch (code) {
    case 120: return 'Zalo: Bạn đang bị cấm nhắn tin cho người lạ.'
    case 166: return `${n}: có thể người dùng này đã bị chặn và bạn không đủ quyền để thêm họ vào nhóm.`
    case 172: return 'Bạn đã vượt quá số nhóm cho phép.'
    case 173: return 'Có vài người đã vượt quá số nhóm cho phép.'
    case 175: return ''
    case 177: return `${n}: người dùng này đã vượt quá số nhóm cho phép.`
    case 178: return `${n} đã là thành viên của nhóm từ trước`
    case 240: return 'Yêu cầu của bạn đã được gửi đến trưởng/phó nhóm chờ xét duyệt'
    case 245: case 263: return `${n} đã được bạn mời vào nhóm và cần xác nhận tham gia`
    case 252: return `${n} đã nằm trong danh sách chờ duyệt.`
    case 259: return 'Bạn không có quyền thực hiện thay đổi trong nhóm vào lúc này'
    case 262: return `${n} đã được mời trước đây nhưng chưa xác nhận tham gia`
    case 281: return `Không thể thêm ${n} vào nhóm vì họ đã đạt giới hạn trò chuyện có Tin nhắn tự xóa`
    case 317: return `Không thể mời ${n} vào nhóm vì link tham gia nhóm chưa được kích hoạt`
    default: return `Thêm ${n} không thành công (${code})`
  }
}

// PC's getErrorText of "Thêm vào nhóm" (invite/multi), per group; 0 and 178 ("Đã là thành viên") count as added
export function multiInviteError(code: number, name: string) {
  switch (code) {
    case 166: return `Bạn không đủ quyền để thêm ${name} vào nhóm`
    case 173: return `${name} đã vượt quá số nhóm cho phép`
    case 175: case 306: return `${name} đã bị trưởng/phó nhóm chặn tham gia nhóm`
    case 240: return 'Yêu cầu của bạn đã được gửi đến trưởng/phó nhóm chờ xét duyệt'
    case 248: return 'Cần chờ admin phê duyệt'
    case 252: return `${name} đã nằm trong danh sách chờ duyệt`
    case 262: return `${name} đã được mời trước đây nhưng chưa xác nhận tham gia`
    case 263: return `${name} đã được bạn mời vào nhóm và cần xác nhận tham gia`
    case 317: return `Không thể mời ${name} vào nhóm vì link tham gia nhóm chưa được kích hoạt`
    case 177: return 'Đã quá số nhóm cho phép'
    case 281: return 'Không thể thêm người này vào nhóm vì họ đã đạt giới hạn trò chuyện có Tin nhắn tự xóa'
    case 833: return 'Không thể thêm người này vào nhóm vì họ đã đạt giới hạn trò chuyện có Chặn chia sẻ'
    case 247: return 'Chặn thêm vào nhóm lại'
    case 264: return `${name} không thể thêm vào nhóm. Họ sẽ nhận được link mời vào nhóm của bạn.`
    default: return `Mời vào nhóm bị lỗi (${code})`
  }
}
