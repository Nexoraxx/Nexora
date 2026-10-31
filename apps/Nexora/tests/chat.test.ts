import { expect, test } from "bun:test";
import { NO_SETTINGS } from "../src/app/chat/constants/chat.constants";
import { unreadCount } from "../src/app/chat/utils/chat.utils";
import type { Thread } from "../src/shared/types";

const thread = (threadId: string, unread: number) => ({ threadId, unread }) as Thread;

test("account badge: unread or marked conversations, muted and hidden ones left out", () => {
  const threads = [thread("a", 3), thread("b", 0), thread("c", 1), thread("d", 2), thread("e", 0)];
  expect(unreadCount(threads)).toBe(3);
  expect(unreadCount(threads, { ...NO_SETTINGS, unread: ["b"], muted: { c: -1 }, hidden: ["d"] })).toBe(2);
  expect(unreadCount(undefined, undefined)).toBe(0);
});
