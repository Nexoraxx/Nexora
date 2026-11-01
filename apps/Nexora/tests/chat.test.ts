import { expect, test } from "bun:test";
import { NO_SETTINGS } from "../src/app/chat/constants/chat.constants";
import { callLog, summary, unreadCount } from "../src/app/chat/utils/chat.utils";
import type { Thread } from "../src/shared/types";

const thread = (threadId: string, unread: number) => ({ threadId, unread }) as Thread;

test("account badge: unread or marked conversations, muted and hidden ones left out", () => {
  const threads = [thread("a", 3), thread("b", 0), thread("c", 1), thread("d", 2), thread("e", 0)];
  expect(unreadCount(threads)).toBe(3);
  expect(unreadCount(threads, { ...NO_SETTINGS, unread: ["b"], muted: { c: -1 }, hidden: ["d"] })).toBe(2);
  expect(unreadCount(undefined, undefined)).toBe(0);
});

test("call logs: Zalo PC's titles, texts and list labels (r6Qt / 4eSn)", () => {
  const log = (action: string, params: object) => ({ action, params: JSON.stringify({ isEnableCallback: 1, ...params }) });
  // own outgoing voice call, 1 min 5 s
  expect(callLog(log("recommened.calltime", { calltype: 0, duration: 65 }), true)).toMatchObject({ title: "Cuộc gọi thoại đi", text: "1 phút 5 giây", missed: false, callback: true });
  // incoming video call
  expect(callLog(log("recommened.calltime", { calltype: 1, duration: 3 }), false)).toMatchObject({ title: "Cuộc gọi video đến", video: true, short: "Cuộc gọi video đến" });
  // missed: red, "Bạn bị nhỡ"; the list says "nhỡ"
  expect(callLog(log("recommened.misscall", { calltype: 0, reason: 2 }), false)).toMatchObject({ title: "Bạn bị nhỡ", text: "Cuộc gọi thoại", missed: true, short: "Cuộc gọi thoại nhỡ" });
  // declined by me / by them, cancelled, busy
  expect(callLog(log("recommened.misscall", { reason: 3 }), false)).toMatchObject({ title: "Bạn đã từ chối", missed: false, short: "Cuộc gọi thoại đến" });
  expect(callLog(log("recommened.misscall", { reason: 3 }), true).title).toBe("Người nhận từ chối");
  expect(callLog(log("recommened.misscall", { reason: 5 }), true).title).toBe("Bạn đã hủy");
  expect(callLog(log("recommened.misscall", { reason: 1 }), true).title).toBe("Người nhận bận");
  // an outgoing call that rang out shows a zero duration, as PC
  expect(callLog(log("recommened.misscall", { reason: 2 }), true)).toMatchObject({ title: "Cuộc gọi thoại đi", text: "0 phút 0 giây" });
  // the thread list doesn't know the direction: PC's reading (incoming)
  expect(summary("chat.recommended", log("recommened.misscall", { calltype: 1 }))).toBe("[Cuộc gọi video nhỡ]");
  expect(callLog(log("recommened.calltime", { duration: 3725 }), true).text).toBe("1 giờ 2 phút 5 giây");
});
