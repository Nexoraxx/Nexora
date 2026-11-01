// Zalo PC default for group_config.num_max_group_a_req
export const GROUP_INFO_BATCH = 100
// friendRequestType holds Zalo's recommType: 1 = suggestion, 2 = received request (sent requests aren't stored, as in Zalo PC)
export const RECEIVED_REQUEST = 2
export const collator = new Intl.Collator('vi')
// Zalo PC keeps friend/onlines this long (list_friend_online_time)
export const ONLINE_TTL = 60_000
// Zalo answers requested/list with error 112 when this account has sent no friend request
export const NO_SENT_REQUESTS = 112
// Zalo PC fetches "Danh sách chặn" 50 at a time
export const BLOCK_PAGE = 50
export const NO_REQUEST = { friendRequestType: null, friendRequestMsg: null, friendRequestSource: null, friendRequestFetchTime: null, friendRequestRead: null }

// /api/social/group/members takes ids in the query here (zca sends GET; PC POSTs 300 at a time)
export const MEMBER_BATCH = 100
