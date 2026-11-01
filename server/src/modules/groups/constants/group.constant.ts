// Zalo PC group_config.max_group_name_length; groupType 1 = NORMAL (2 = community); memberType -1 = friend
export const MAX_NAME = 50
export const NORMAL = 1
export const FRIEND = -1
// PC's MULTI_GROUP_INTERACTION_SRC.PROFILE
export const FROM_PROFILE = 0

export const NO_PERMISSION = 'Chỉ có trưởng/phó nhóm thực hiện được tính năng này.'
// PC's STR_ERROR_CODE_* for any group call
export const GROUP_ERRORS: Record<number, string> = { 161: 'Nhóm không tồn tại', 164: 'Bạn không còn là thành viên trong nhóm này', 165: 'Nhóm không có thành viên', 166: NO_PERMISSION }
export const CREATE_ERRORS: Record<number, string> = {
  160: 'Tên nhóm không hợp lệ',
  173: 'Có vài người đã vượt quá số nhóm cho phép, không đủ số người để tạo nhóm (tối thiểu là 3)',
  175: 'Tất cả những người này đã block bạn',
  177: 'Bạn đã vượt quá số nhóm cho phép',
  181: 'Có vài người đã block bạn, không đủ số người để tạo nhóm (tối thiểu là 3)',
  250: 'Tên nhóm không hợp lệ',
  254: 'Bạn không có quyền tạo nhóm vào lúc này',
  270: 'Bạn đã đạt giới hạn tạo nhóm trong ngày.',
}
// "Lời mời vào nhóm" / link joins (STR_GROUP_INVITATION_JOIN_ERR_*)
export const JOIN_ERRORS: Record<number, string> = {
  166: 'Bạn đã bị trưởng nhóm chặn tham gia nhóm này',
  177: 'Bạn đã vượt quá số nhóm cho phép',
  178: 'Đã là thành viên của nhóm',
  212: 'Lời mời tham gia nhóm không tồn tại',
  228: 'Lời mời tham gia nhóm đã hết hạn',
  240: 'Yêu cầu của bạn đã được gửi đến trưởng/phó nhóm chờ phê duyệt',
  257: 'Bạn không có quyền tham gia nhóm vào lúc này',
  259: 'Bạn không có quyền thực hiện thay đổi trong nhóm vào lúc này',
}
// "Các yêu cầu cần được phê duyệt" (STR_APPROVE_MEMBER_ERR_*)
export const REVIEW_ERRORS: Record<number, string> = {
  166: NO_PERMISSION,
  170: 'Đã bị từ chối bởi người khác',
  172: 'Nhóm đã vượt quá số lượng thành viên cho phép',
  177: 'Người này đã đạt giới hạn số nhóm tối đa',
  178: 'Đã được approve bởi người khác',
}
