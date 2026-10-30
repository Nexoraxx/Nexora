import { expect, test } from "bun:test";
import { editMarks, emojiPosition, emojiText, findMentions, fold, formatLines, lastSeen, markWords, matchQuick, marksFrom, matchStickerKeyword, slashQuery, splitMentions, stylesFrom, toggleMark, tokenize } from "../src/shared/utils/text.utils";

test("emoji tokens: Zalo codes as whole words (any case), unicode anywhere, everything else stays text", () => {
  expect(tokenize(":d hello")).toEqual([{ emoji: ":d", text: ":d" }, " hello"]);
  expect(tokenize("lúc 8:30 nhé :D")).toEqual(["lúc 8:30 nhé ", { emoji: ":d", text: ":D" }]);
  expect(tokenize("Xin chào😀!")).toEqual(["Xin chào", { emoji: "😀", text: "😀" }, "!"]);
  expect(tokenize("xem http://a.vn/:) đi")).toEqual(["xem http://a.vn/:) đi"]);
  expect(tokenize("a\n/-heart")).toEqual(["a\n", { emoji: "/-heart", text: "/-heart" }]);
  // the panel inserts unicode for named emoji, and that unicode renders from the sprite too
  expect(emojiText(":grinning:")).toBe("😀");
  expect(emojiText(":d")).toBe(":d");
  expect(emojiPosition("😀")).toBeTruthy();
});

test("sticker keyword matching follows Zalo PC: last line before the caret, longest suffix, accents optional", () => {
  const keywords = new Set(["hi", "chào bạn", "yeu"]);
  expect(matchStickerKeyword("ok hi", 5, keywords, 3)).toBe("hi");
  expect(matchStickerKeyword("À Chào bạn", 10, keywords, 3)).toBe("chào bạn");
  expect(matchStickerKeyword("anh yêu", 7, keywords, 3)).toBe("yeu");
  expect(matchStickerKeyword("hi there", 2, keywords, 3)).toBe("hi");
  expect(matchStickerKeyword("hi\nok", 5, keywords, 3)).toBe("");
  expect(matchStickerKeyword("#hi", 3, keywords, 3)).toBe("");
  expect(matchStickerKeyword("chào bạn", 8, keywords, 1)).toBe("");
  expect(fold("Đặng")).toBe("dang");
});

test("mentions: located by name when sending, cut out of the text when shown", () => {
  const text = "@Anh và @An ơi, @All";
  const picked = [
    { uid: "a", name: "An" },
    { uid: "h", name: "Anh" },
    { uid: "-1", name: "All" },
    { uid: "x", name: "Xoá rồi" },
  ];
  const mentions = findMentions(text, picked);
  expect(mentions).toEqual([
    { uid: "h", pos: 0, len: 4 },
    { uid: "a", pos: 8, len: 3 },
    { uid: "-1", pos: 16, len: 4 },
  ]);
  expect(splitMentions(text, mentions)).toEqual([{ text: "@Anh", uid: "h" }, " và ", { text: "@An", uid: "a" }, " ơi, ", { text: "@All", uid: "-1" }]);
  // the same person twice takes two places
  expect(findMentions("@An @An", [{ uid: "a", name: "An" }, { uid: "a", name: "An" }]).map((m) => m.pos)).toEqual([0, 4]);
  expect(splitMentions("hi", [{ uid: "a", pos: 1, len: 5 }])).toEqual(["hi"]);
  expect(splitMentions("hi", null)).toEqual(["hi"]);
});

test("search marks: query words matched without tones, đ or case; emoji keep their place", () => {
  expect(markWords("Đi ăn Phở😀 không", "di pho")).toEqual([
    { text: "Đi", hit: true },
    { text: " ăn ", hit: false },
    { text: "Phở", hit: true },
    { text: "😀 không", hit: false },
  ]);
  expect(markWords("abc", "")).toEqual([{ text: "abc", hit: false }]);
});

test("formatting: styles round-trip as comma-joined runs; edits shift marks; toolbar toggles", () => {
  const text = "Đỏ đậm";
  const marks = marksFrom(text, [{ start: 0, len: 2, st: "b" }, { start: 0, len: 2, st: "c_db342e" }, { start: 3, len: 3, st: "f_20" }]);
  expect(stylesFrom(marks)).toEqual([{ start: 0, len: 2, st: "b,c_db342e" }, { start: 3, len: 3, st: "f_20" }]);
  // typing inside a bold run stays bold; text inserted before shifts it
  expect(stylesFrom(editMarks(marks, text, "Đỏo đậm"))[0]).toEqual({ start: 0, len: 3, st: "b,c_db342e" });
  expect(stylesFrom(editMarks(marks, text, ">> " + text))[0]).toEqual({ start: 3, len: 2, st: "b,c_db342e" });
  // bold toggles off when all of it is bold; a color replaces the old one; "c_" clears it
  expect(stylesFrom(toggleMark(marks, text, 0, 2, "b"))).toEqual([{ start: 0, len: 2, st: "c_db342e" }, { start: 3, len: 3, st: "f_20" }]);
  expect(stylesFrom(toggleMark(marks, text, 0, 1, "c_15a85f"))[0]).toEqual({ start: 0, len: 1, st: "b,c_15a85f" });
  expect(stylesFrom(toggleMark(marks, text, 0, 6, "c_"))).toEqual([{ start: 0, len: 2, st: "b" }, { start: 3, len: 3, st: "f_20" }]);
  // lists cover every line the selection touches; toggling again clears them
  const two = "một\nhai\nba";
  const listed = toggleMark(Array(10).fill(""), two, 1, 5, "lst_1");
  expect(stylesFrom(listed)).toEqual([{ start: 0, len: 3, st: "lst_1" }, { start: 4, len: 3, st: "lst_1" }]);
  expect(stylesFrom(toggleMark(listed, two, 0, 0, "lst_1"))).toEqual([{ start: 4, len: 3, st: "lst_1" }]);
});

test("formatted lines: list codes per line, style runs and mentions as segments", () => {
  const text = "@An ơi\nđi";
  const lines = formatLines(text, marksFrom(text, [{ start: 0, len: 6, st: "lst_2" }, { start: 4, len: 2, st: "b" }]), [{ uid: "1", pos: 0, len: 3 }]);
  expect(lines).toEqual([
    { codes: ["lst_2"], segments: [{ text: "@An", codes: ["lst_2"], uid: "1" }, { text: " ", codes: ["lst_2"] }, { text: "ơi", codes: ["b", "lst_2"] }] },
    { codes: [], segments: [{ text: "đi", codes: [] }] },
  ]);
});

test("last seen follows Zalo PC's header: 3 min is just now, then minutes, hours, yesterday, date", () => {
  const now = new Date(2026, 9, 30, 12, 0).getTime();
  expect(lastSeen(now - 170_000, now)).toBe("Vừa truy cập");
  expect(lastSeen(now + 60_000, now)).toBe("Vừa truy cập");
  expect(lastSeen(now + 200_000, now)).toBe("");
  expect(lastSeen(now - 5 * 60_000, now)).toBe("Truy cập 5 phút trước");
  expect(lastSeen(now - 2 * 3600_000, now)).toBe("Truy cập 2 giờ trước");
  expect(lastSeen(new Date(2026, 9, 29, 8, 0).getTime(), now)).toBe("Truy cập hôm qua");
  expect(lastSeen(new Date(2026, 9, 5, 8, 0).getTime(), now)).toBe("Truy cập 5/10/2026");
});

test("quick messages: '/' word before the caret, prefix match with the closest keyword first", () => {
  expect(slashQuery("/", 1)).toBe("");
  expect(slashQuery("chào /xin", 9)).toBe("xin");
  expect(slashQuery("a/xin", 5)).toBeUndefined();
  expect(slashQuery("/xin chào", 9)).toBeUndefined();
  expect(slashQuery("/xin chào", 4)).toBe("xin");
  const items = [{ keyword: "xinchao" }, { keyword: "Xin" }, { keyword: "camon" }, { keyword: "xinloi" }];
  expect(matchQuick(items, "")).toBe(items);
  expect(matchQuick(items, "xin").map((i) => i.keyword)).toEqual(["Xin", "xinloi", "xinchao"]);
  expect(matchQuick(items, "zz")).toEqual([]);
});
