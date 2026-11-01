-- Nexora schema = Zalo PC 26.10.20 entities (reverse/pc-dist/search-worker.*.js) + multi-account.
-- Every per-account table: accountId leads the PK and cascades from account (needs PRAGMA foreign_keys=ON).
-- Column names follow Zalo so code ported from the reverse maps 1:1. Zalo quirk: conversation.userId /
-- groups.userId / group_info.userId / message.toUid all mean thread id (zca: message.threadId), user or group.
-- Tables keep Zalo's split by write rate (cold metadata vs per-message state): an UPDATE rewrites the whole row,
-- so merging them makes every new message / seen event rewrite the cold JSON too.
-- Types: string/snowflake → TEXT, integer/boolean → INTEGER, json → TEXT, timestamps → INTEGER ms.

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ===== Global =====

-- zalo: refresh_token → zca-js credentials
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY, -- zalo uid
  name TEXT NOT NULL,
  avatar TEXT,
  phoneNumber TEXT,
  imei TEXT NOT NULL,
  cookie TEXT NOT NULL, -- json
  userAgent TEXT NOT NULL,
  language TEXT,
  proxy TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'locked', 'retired')),
  createdAt INTEGER NOT NULL,
  lastLoginAt INTEGER
);

-- same catalog for every account; per-account recents live in sticker_usage
CREATE TABLE IF NOT EXISTS sticker (
  cateId INTEGER NOT NULL,
  id INTEGER NOT NULL,
  type INTEGER, text TEXT, uri TEXT, fkey INTEGER, status INTEGER,
  stickerUrl TEXT, stickerSpriteUrl TEXT, stickerWebpUrl TEXT,
  totalFrames INTEGER, duration INTEGER, effectId INTEGER, checksum TEXT, ext INTEGER, source INTEGER,
  fss TEXT, fssInfo TEXT, version INTEGER, extInfo TEXT, fetchTs INTEGER, updateState INTEGER,
  PRIMARY KEY (cateId, id)
);

-- ===== Per account: core =====

-- zalo: async-store, info-cache, retry-cache, friend-blocked, metas. Sync cursors, mute/hidden-chat settings, ...
CREATE TABLE IF NOT EXISTS kv (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  val TEXT,
  PRIMARY KEY (accountId, key)
);

-- zalo: friend + friends_info + alias + global_noiseid. Friends, strangers and requests; isFr tells them apart.
CREATE TABLE IF NOT EXISTS user (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  userId TEXT NOT NULL,
  username TEXT, displayName TEXT, zaloName TEXT, alias TEXT,
  avatar TEXT, bgavatar TEXT, cover TEXT,
  gender INTEGER, dob INTEGER DEFAULT 0, sdob TEXT DEFAULT '', status TEXT, phoneNumber TEXT DEFAULT '',
  isFr INTEGER NOT NULL DEFAULT 0, isBlocked INTEGER, type INTEGER, key INTEGER, userKey TEXT,
  isActive INTEGER, isActivePC INTEGER, isActiveWeb INTEGER, isValid INTEGER, accountStatus INTEGER, user_mode INTEGER,
  lastActionTime INTEGER, lastUpdateTime INTEGER, lastOnlineTime INTEGER, createdTs INTEGER, _lastRequestTime INTEGER,
  friendRequestMsg TEXT, friendRequestSource INTEGER, friendRequestType INTEGER, friendRequestSrc INTEGER,
  friendRequestSortOrder INTEGER, friendRequestFetchTime INTEGER, friendRequestRead INTEGER,
  oaInfo TEXT, oa_status TEXT, bizPkg TEXT, bizInfo TEXT, zentInfo TEXT, userRank TEXT,
  globalId TEXT, globalNoiseId TEXT,
  PRIMARY KEY (accountId, userId)
);
CREATE INDEX IF NOT EXISTS user_friend ON user (accountId, displayName) WHERE isFr = 1;

-- zalo: group (renamed: GROUP is an SQL keyword). Lean row for the group list; memberIds lives in group_info only.
CREATE TABLE IF NOT EXISTS groups (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  userId TEXT NOT NULL, -- group id
  displayName TEXT, avatar TEXT, bgavatar TEXT, defaultAvatar INTEGER, "desc" TEXT,
  type INTEGER, subType INTEGER, visibility INTEGER, status INTEGER, e2ee INTEGER, version TEXT, globalId TEXT,
  creatorId TEXT, authorId TEXT, totalMember INTEGER, topMember TEXT, topic TEXT, lastUpdate INTEGER,
  PRIMARY KEY (accountId, userId)
);

-- zalo: group_info. Detail, rewritten on member/admin/setting events.
CREATE TABLE IF NOT EXISTS group_info (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  userId TEXT NOT NULL, -- group id
  memberIds TEXT, adminIds TEXT, maxMember INTEGER, setting TEXT,
  pendingApprove INTEGER, pendingApproveHintShow INTEGER, pendingApproveUsers TEXT,
  lastUpdate INTEGER,
  PRIMARY KEY (accountId, userId)
);

-- zalo: group_topics (pinned board items)
CREATE TABLE IF NOT EXISTS group_topics (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  conversationId TEXT NOT NULL,
  topics TEXT, boardVersion INTEGER, lastFetch INTEGER,
  PRIMARY KEY (accountId, conversationId)
);

-- zalo: conversation. Cold: pin, label, flags.
CREATE TABLE IF NOT EXISTS conversation (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  userId TEXT NOT NULL, -- thread id
  isGroup INTEGER,
  localType INTEGER, outside INTEGER, pinned INTEGER, label INTEGER, respondedByMe INTEGER, numMsg INTEGER,
  firstSmsLocalId TEXT, lastSmsLocalId TEXT, preLastSmsLocalId TEXT, lastActionId TEXT,
  syncFromMobile INTEGER, infoCheckSearch TEXT,
  topOut TEXT, topOutTimeOut TEXT, topOutImprTimeOut TEXT,
  PRIMARY KEY (accountId, userId)
);

-- zalo: preview_message. Hot: rewritten on every message; orders the chat list.
CREATE TABLE IF NOT EXISTS preview_message (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  convId TEXT NOT NULL,
  msgId TEXT NOT NULL, cliMsgId TEXT, fromUid TEXT, toUid TEXT, dName TEXT, isGroup INTEGER,
  message TEXT, messageType TEXT, messageTime INTEGER NOT NULL, status INTEGER, substate INTEGER,
  urgencyLevel INTEGER, properties TEXT, mentions TEXT, ttl INTEGER, computedMessage TEXT, computedIcon TEXT,
  PRIMARY KEY (accountId, convId)
);
CREATE INDEX IF NOT EXISTS preview_message_time ON preview_message (accountId, messageTime);

-- zalo: unread_conv. Hot: every message and every mark-as-read.
CREATE TABLE IF NOT EXISTS unread_conv (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  convId TEXT NOT NULL,
  smsUnreadCount INTEGER NOT NULL DEFAULT 0, smsUnreadNotCount INTEGER NOT NULL DEFAULT 0,
  mentionUnreadCount INTEGER NOT NULL DEFAULT 0, strangerUnreadCount INTEGER NOT NULL DEFAULT 0,
  lastProcessMsgId TEXT, lastProcessMsgTime INTEGER, lastSeenReactId TEXT, unreadMark TEXT,
  PRIMARY KEY (accountId, convId)
);

CREATE TABLE IF NOT EXISTS unread_react (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  conversationId TEXT NOT NULL,
  userId TEXT, msgId TEXT, reactIcon TEXT, reactionId TEXT, reactionCliId TEXT,
  PRIMARY KEY (accountId, conversationId)
);

-- zalo: ConvMsgStatus. Hot: every seen/delivered event; not needed by the chat list.
CREATE TABLE IF NOT EXISTS conv_msg_status (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  userId TEXT NOT NULL, -- thread id
  data TEXT,
  PRIMARY KEY (accountId, userId)
);

-- zalo: message (UI-only columns dropped: isSelected, isLastMsg, z_parsedTokens, __isUpdateMessage, __updateData,
-- textArguments, actionText, cancelled, resend, forwardFail, isErrorInfo, sequenseId typo).
-- Pending outgoing: msgId = cliMsgId + isLocalMsgId = 1 until the server ack swaps it.
-- Write with INSERT ... ON CONFLICT DO UPDATE, not INSERT OR REPLACE: REPLACE skips the delete trigger and leaves stale FTS rows.
CREATE TABLE IF NOT EXISTS message (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  msgId TEXT NOT NULL,
  cliMsgId TEXT,
  toUid TEXT NOT NULL, -- thread id
  fromUid TEXT, dName TEXT,
  msgType TEXT NOT NULL, -- zca string ('webchat', 'chat.photo', ...); Zalo PC maps it to an int
  sendDttm INTEGER NOT NULL, serverTime INTEGER, localDttm INTEGER, originTs INTEGER,
  message TEXT, -- content json
  msgText TEXT, -- plain text for search: text body, file name, link title
  content TEXT, act TEXT, action TEXT, eventInfo TEXT, updateMemberIds TEXT, notify TEXT,
  src INTEGER, status INTEGER, subState INTEGER, sendErrorCode INTEGER, isLocalMsgId INTEGER,
  cmd INTEGER, st INTEGER, at INTEGER, ttl INTEGER,
  mentions TEXT, quote TEXT, refMessageId TEXT, reference TEXT,
  properties TEXT, paramsExt TEXT, extra TEXT, footer TEXT, friendRequestData TEXT,
  dimension TEXT, width INTEGER, height INTEGER, vOrient INTEGER, fileSize INTEGER,
  localPath TEXT, folderPath TEXT, previewThumb TEXT, zipKey TEXT,
  originMsgType TEXT, subType INTEGER, platformType INTEGER, upSrc INTEGER, root INTEGER,
  syncFromMobile INTEGER, topOut TEXT, topOutTimeOut TEXT, topOutImprTimeOut TEXT,
  urgency INTEGER, e2eeStatus INTEGER, sequenceId INTEGER, oldMsgId TEXT, uidSenderDel TEXT,
  hasReact INTEGER, reader INTEGER, staredDttm INTEGER,
  PRIMARY KEY (accountId, msgId)
);
CREATE INDEX IF NOT EXISTS message_thread ON message (accountId, toUid, sendDttm);
CREATE INDEX IF NOT EXISTS message_thread_id ON message (accountId, toUid, CAST(msgId AS INTEGER));
CREATE INDEX IF NOT EXISTS message_e2ee_untagged ON message (cmd) WHERE cmd IN (551, 552) AND msgType != 'chat.e2ee' AND e2eeStatus IS NOT 3000;
CREATE INDEX IF NOT EXISTS message_e2ee_transport ON message (accountId) WHERE cmd IN (513, 713);
CREATE INDEX IF NOT EXISTS message_cli ON message (accountId, cliMsgId);
CREATE INDEX IF NOT EXISTS message_status ON message (accountId, status, sendDttm);
-- replaces zalo image/file/link/utils_media: media panel = filter by msgType
CREATE INDEX IF NOT EXISTS message_type ON message (accountId, toUid, msgType, sendDttm);
-- "Tin nhắn tự xóa": expired rows are purged on read
CREATE INDEX IF NOT EXISTS message_ttl ON message (accountId, sendDttm) WHERE ttl > 0;
-- replaces zalo star_message
CREATE INDEX IF NOT EXISTS message_starred ON message (accountId, staredDttm) WHERE staredDttm IS NOT NULL;
-- replaces zalo MsgUrgency
CREATE INDEX IF NOT EXISTS message_urgent ON message (accountId, toUid, sendDttm) WHERE urgency > 0;
-- replaces zalo Quotes/ThreadHis/ThreadMsg: replies to a message
CREATE INDEX IF NOT EXISTS message_reply ON message (accountId, json_extract(quote, '$.globalMsgId')) WHERE quote IS NOT NULL;

-- replaces zalo idx_queue/stkw/stidx/stcont. unicode61 folds Vietnamese tones but not đ, so the triggers
-- fold đ→d; apply the same replace() to the MATCH query.
CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(text, content = '', contentless_delete = 1, tokenize = 'unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS message_fts_ai AFTER INSERT ON message WHEN new.msgText IS NOT NULL BEGIN
  INSERT INTO message_fts (rowid, text) VALUES (new.rowid, replace(replace(new.msgText, 'đ', 'd'), 'Đ', 'D'));
END;
CREATE TRIGGER IF NOT EXISTS message_fts_ad AFTER DELETE ON message BEGIN
  DELETE FROM message_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS message_fts_au AFTER UPDATE OF msgText ON message BEGIN
  DELETE FROM message_fts WHERE rowid = old.rowid;
  INSERT INTO message_fts (rowid, text) SELECT new.rowid, replace(replace(new.msgText, 'đ', 'd'), 'Đ', 'D') WHERE new.msgText IS NOT NULL;
END;

-- zalo: MsgInfo. Separate from message: seen/delivered churns, message rows are fat.
CREATE TABLE IF NOT EXISTS msg_info (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  msgId TEXT NOT NULL,
  seenUids TEXT, deliveredUids TEXT, extraJson TEXT,
  PRIMARY KEY (accountId, msgId)
);

CREATE TABLE IF NOT EXISTS reaction (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  rMsgId TEXT NOT NULL,
  rClientMsgId TEXT, idTo TEXT, msgType TEXT, rMsgType INTEGER,
  currentIcon INTEGER, reactions TEXT, lastSender TEXT, lastUpdate INTEGER,
  lastReceiveReactId TEXT, lastReactIcon INTEGER, ts INTEGER,
  PRIMARY KEY (accountId, rMsgId)
);

-- unread @mentions of this account
CREATE TABLE IF NOT EXISTS mention (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  msgId TEXT NOT NULL,
  userId TEXT NOT NULL,
  PRIMARY KEY (accountId, msgId)
);

-- ===== Per account: sync / disappearing messages =====

-- zalo: TTLItem
CREATE TABLE IF NOT EXISTS ttl_item (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  msgId TEXT NOT NULL, ttlType TEXT NOT NULL,
  cliMsgId TEXT, fromUid TEXT, toUid TEXT, mediaType TEXT,
  sendDttm INTEGER, serverTime INTEGER, beginTime INTEGER, ttl INTEGER, expireOn INTEGER NOT NULL,
  PRIMARY KEY (accountId, msgId, ttlType)
);
CREATE INDEX IF NOT EXISTS ttl_item_expire ON ttl_item (expireOn);

CREATE TABLE IF NOT EXISTS ttlmsg (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  globalDelMsgId TEXT NOT NULL,
  clientDelMsgId TEXT, conversationId TEXT, type INTEGER, ts INTEGER, expired INTEGER,
  PRIMARY KEY (accountId, globalDelMsgId)
);
CREATE INDEX IF NOT EXISTS ttlmsg_expired ON ttlmsg (expired);

CREATE TABLE IF NOT EXISTS missing_message_range (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  convId TEXT NOT NULL, fromTs INTEGER, toTs INTEGER, reason TEXT, status INTEGER,
  PRIMARY KEY (accountId, id)
);
CREATE INDEX IF NOT EXISTS missing_message_range_conv ON missing_message_range (accountId, convId, toTs);

CREATE TABLE IF NOT EXISTS cloud_segment (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  conversationId TEXT NOT NULL,
  cloudFirstSmsLocalId TEXT, cloudSegmentCheck TEXT DEFAULT '[]', cloudSegmentCheckAutoFetch TEXT DEFAULT '[]',
  hasMore INTEGER DEFAULT 1, lastCloudVerifiedDttm INTEGER, lastDeletedMsgID TEXT, lastGetMaxRecentTs INTEGER, maxCloudMsgId TEXT,
  PRIMARY KEY (accountId, conversationId)
);

-- zalo: SyncDownload (sync history from phone)
CREATE TABLE IF NOT EXISTS sync_download (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  convId TEXT NOT NULL, fromId TEXT NOT NULL, clientMsgId INTEGER NOT NULL,
  actionId TEXT, globalMsgId TEXT, platform INTEGER, deviceId TEXT, actionSource INTEGER,
  sendDttm INTEGER, sendDate INTEGER, status INTEGER, submited INTEGER, mediaType TEXT, metaData TEXT, errorName TEXT,
  PRIMARY KEY (accountId, convId, fromId, clientMsgId)
);
CREATE INDEX IF NOT EXISTS sync_download_status ON sync_download (accountId, sendDate, status);

-- ===== Per account: features =====

CREATE TABLE IF NOT EXISTS notifications (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  type INTEGER, uid TEXT, toUid TEXT, msgId TEXT,
  PRIMARY KEY (accountId, ts)
);

CREATE TABLE IF NOT EXISTS label (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  id INTEGER NOT NULL,
  text TEXT, textKey TEXT, color TEXT, emoji TEXT, "offset" INTEGER, createTime INTEGER, conversations TEXT,
  PRIMARY KEY (accountId, id)
);

CREATE TABLE IF NOT EXISTS quick_message (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  id INTEGER NOT NULL,
  keyword TEXT, type INTEGER, message TEXT, media TEXT, createdTime INTEGER, lastModified INTEGER, version INTEGER,
  PRIMARY KEY (accountId, id)
);

CREATE TABLE IF NOT EXISTS poll (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  poll_id INTEGER NOT NULL,
  group_id TEXT, creator TEXT, updater TEXT, question TEXT, options TEXT, num_vote INTEGER,
  joined INTEGER, closed INTEGER, allow_multi_choices INTEGER, allow_add_new_option INTEGER,
  is_anonymous INTEGER, is_hide_vote_preview INTEGER, poll_type INTEGER, poll_version INTEGER,
  created_time INTEGER, updated_time INTEGER, expired_time INTEGER, msgId TEXT, cliMsgId TEXT,
  PRIMARY KEY (accountId, poll_id)
);

CREATE TABLE IF NOT EXISTS todo (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  creator TEXT, content TEXT, description TEXT, status INTEGER,
  assignees TEXT, watchers TEXT, dueDate INTEGER, dateDefaultType INTEGER, personalBoardType INTEGER,
  dingTimes INTEGER, schedule TEXT, attach TEXT, extra TEXT, createTime INTEGER, updateTime INTEGER,
  PRIMARY KEY (accountId, id)
);

-- zalo: topic_v2 (group board: notes, reminders)
CREATE TABLE IF NOT EXISTS topic (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  groupId TEXT NOT NULL, id TEXT NOT NULL,
  type INTEGER, creatorId TEXT, creatorUid TEXT, editorId TEXT, editorUid TEXT, toUid TEXT,
  emoji TEXT, color INTEGER, params TEXT, eventType INTEGER, action INTEGER,
  responseMem TEXT, listRespMem TEXT, "repeat" INTEGER, repeatData TEXT, repeatInfo TEXT,
  duration INTEGER, startTime INTEGER, createTime INTEGER, editTime INTEGER,
  PRIMARY KEY (accountId, groupId, id)
);

CREATE TABLE IF NOT EXISTS board_suggest (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  groupId TEXT NOT NULL, actionId TEXT NOT NULL,
  PRIMARY KEY (accountId, groupId, actionId)
);

-- zalo: catalog_db, product_db (zBusiness)
CREATE TABLE IF NOT EXISTS catalog (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  catalog_id TEXT NOT NULL,
  ownerId TEXT, catalog_name TEXT, catalog_photo TEXT DEFAULT '', isDefault INTEGER DEFAULT 0,
  totalProduct INTEGER DEFAULT 0, version_catalog INTEGER DEFAULT 0, path TEXT DEFAULT '', created_time INTEGER DEFAULT 0,
  PRIMARY KEY (accountId, catalog_id)
);
CREATE TABLE IF NOT EXISTS product (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  catalog_id TEXT, owner_id TEXT, product_name TEXT, description TEXT, price TEXT, currency_unit TEXT,
  product_photos TEXT, create_time INTEGER,
  PRIMARY KEY (accountId, product_id)
);
CREATE INDEX IF NOT EXISTS product_catalog ON product (accountId, catalog_id);

-- zalo: zcloud, zcloud_upload (Cloud của tôi). Zalo also indexes zKey/zSize/zType; add when the cloud browser sorts by them.
CREATE TABLE IF NOT EXISTS zcloud (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  noiseId TEXT NOT NULL,
  action INTEGER, actionType INTEGER, ts INTEGER, cliTs INTEGER, verified INTEGER,
  msgInfo TEXT, mediaInfo TEXT, encryptInfo TEXT, cloudInfo TEXT,
  zKey TEXT, zDate INTEGER, zSize INTEGER, zConv TEXT, zType TEXT, localPath TEXT,
  PRIMARY KEY (accountId, noiseId)
);
CREATE INDEX IF NOT EXISTS zcloud_date ON zcloud (accountId, zDate);
CREATE INDEX IF NOT EXISTS zcloud_conv_date ON zcloud (accountId, zConv, zDate);
CREATE TABLE IF NOT EXISTS zcloud_upload (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  msgId TEXT NOT NULL,
  convId TEXT, cliMsgId TEXT, fromUid TEXT, toUid TEXT, msgType TEXT, sendDttm INTEGER, src TEXT, uploadedAt INTEGER DEFAULT 0,
  PRIMARY KEY (accountId, msgId)
);
CREATE INDEX IF NOT EXISTS zcloud_upload_pending ON zcloud_upload (accountId, uploadedAt);

-- zalo: sticker-usage + sticker.recentItem*
CREATE TABLE IF NOT EXISTS sticker_usage (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  dttm INTEGER NOT NULL,
  data TEXT,
  PRIMARY KEY (accountId, dttm)
);

-- zalo: ai_translation_settings + ai_translation_consent
CREATE TABLE IF NOT EXISTS ai_translation (
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  convId TEXT NOT NULL,
  auto INTEGER, suggest INTEGER, srcLang TEXT, desLang TEXT, version INTEGER,
  flow TEXT, touVersion INTEGER, touUrl TEXT, consentedAt INTEGER,
  PRIMARY KEY (accountId, convId)
);

-- ===== Per account: E2EE (Signal-style key store; only needed once E2EE chats are implemented) =====

CREATE TABLE IF NOT EXISTS e2ee_identity (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, keyId TEXT NOT NULL, keyPair TEXT, ts INTEGER, regId INTEGER, version INTEGER, PRIMARY KEY (accountId, keyId));
CREATE TABLE IF NOT EXISTS e2ee_prekey (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, keyId INTEGER NOT NULL, keyPair TEXT, ts INTEGER, regId INTEGER, version INTEGER, PRIMARY KEY (accountId, keyId));
CREATE TABLE IF NOT EXISTS e2ee_signed_prekey (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, keyId INTEGER NOT NULL, keyPair TEXT, ts INTEGER, regId INTEGER, version INTEGER, PRIMARY KEY (accountId, keyId));
CREATE TABLE IF NOT EXISTS e2ee_registration (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, identifier TEXT NOT NULL, regId INTEGER, ts INTEGER, oldRegIds TEXT, PRIMARY KEY (accountId, identifier));
CREATE TABLE IF NOT EXISTS e2ee_session (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, identifier TEXT NOT NULL, record TEXT, PRIMARY KEY (accountId, identifier));
CREATE TABLE IF NOT EXISTS e2ee_group (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, id TEXT NOT NULL, sessions TEXT, sessionsInfo TEXT, enabledGroups TEXT, refetchedUsers TEXT, rqdReinitGroups TEXT, rqdResetKey TEXT, staleUsers TEXT, ts INTEGER, cipherId TEXT, resetKeyAt INTEGER, PRIMARY KEY (accountId, id));
CREATE TABLE IF NOT EXISTS e2ee_meta (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, identifier TEXT NOT NULL, devices TEXT, errorInitAll INTEGER, waiting INTEGER, upgrading INTEGER, PRIMARY KEY (accountId, identifier));
CREATE TABLE IF NOT EXISTS e2ee_metadata (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, uid TEXT NOT NULL, devices TEXT, status INTEGER, rqdReinitAll INTEGER, waitingAck INTEGER, e2dErr TEXT, disableTs INTEGER, PRIMARY KEY (accountId, uid));
CREATE TABLE IF NOT EXISTS e2ee_hash (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, sha256 TEXT NOT NULL, ts INTEGER, PRIMARY KEY (accountId, sha256));
CREATE TABLE IF NOT EXISTS e2ee_deciphered (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, key TEXT NOT NULL, content TEXT, ts INTEGER, PRIMARY KEY (accountId, key));
CREATE TABLE IF NOT EXISTS enclave_root (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, userId TEXT NOT NULL, keyId TEXT, key TEXT, provider TEXT, createdAt INTEGER, metadataMAC BLOB, PRIMARY KEY (accountId, userId));
CREATE TABLE IF NOT EXISTS enclave_keyring (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, keyId TEXT NOT NULL, userId TEXT, usage TEXT, key TEXT, status TEXT, createdAt INTEGER, PRIMARY KEY (accountId, keyId));
CREATE TABLE IF NOT EXISTS trust_identity (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, uid TEXT NOT NULL, pubKey TEXT, privKey TEXT, primaryKey TEXT, verified TEXT, status TEXT, PRIMARY KEY (accountId, uid));
CREATE TABLE IF NOT EXISTS link_history (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, masterId TEXT NOT NULL, uid TEXT, companionId INTEGER, linkingSecret TEXT, identity TEXT, primaryIdentity TEXT, linkId TEXT, linkingTimestamp INTEGER, PRIMARY KEY (accountId, masterId));
CREATE TABLE IF NOT EXISTS device_list (accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, uid TEXT NOT NULL, devices TEXT, PRIMARY KEY (accountId, uid));

-- ===== Nexora only: "Gửi hàng loạt" (not a Zalo entity) =====

-- message templates with {{variables}}, shared by every account
CREATE TABLE IF NOT EXISTS bulk_template (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- one run of a text over picked friends of one account
CREATE TABLE IF NOT EXISTS bulk_send (
  id INTEGER PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running', 'paused', 'done', 'cancelled')),
  pauseReason TEXT,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bulk_send_account ON bulk_send (accountId, createdAt);

-- text: filled in for this person when the run was created. 'sending' is set before the Zalo call, so one found
-- after a restart may or may not have gone out: it becomes 'unknown' and is never sent again
CREATE TABLE IF NOT EXISTS bulk_send_recipient (
  sendId INTEGER NOT NULL REFERENCES bulk_send(id) ON DELETE CASCADE,
  userId TEXT NOT NULL,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'sent', 'failed', 'unknown', 'skipped')),
  error TEXT,
  msgId TEXT,
  sentAt INTEGER,
  PRIMARY KEY (sendId, userId)
);
