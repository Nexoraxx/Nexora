// Zalo PC's global search caps: results kept per section (the "Tất cả" tab shows 6 contacts, 3 messages, 3 files)
export const MAX_CONTACTS = 100
export const MAX_MESSAGES = 100
// sync_recent_search: num_item_show 20 contacts / groups, num_item_kw 5 keywords
export const MAX_RECENT = 20
export const MAX_KEYWORDS = 5
// recentsearch/update errors after which PC reloads the list (version conflict)
export const STALE_VERSION = new Set([160, 266])
