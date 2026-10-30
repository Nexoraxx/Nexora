import emoji from "@/shared/constants/emoji.json";
import type { Token, Mention, TextStyle, Marks, Line } from "@/shared/models/text.model";

// accent-insensitive Vietnamese: "dang" matches "Đặng"
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

const positions: Record<string, string> = emoji.pos;
const inserts: Record<string, string> = emoji.insert;

export const emojiPosition = (key: string) => positions[key];
// What the panel puts in the text: Zalo codes stay as typed (":d"), named ones become the unicode character
export const emojiText = (key: string) => inserts[key] ?? key;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unicodeEmoji = new RegExp(
  `(${Object.keys(positions)
    .filter((k) => /[^\x00-\x7f]/.test(k))
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|")})`,
  "u",
);

// Zalo draws both its legacy codes and unicode emoji from its sprite. Unicode emoji match anywhere;
// ASCII codes only as a whole word, so "8:30" or URLs stay text (Zalo PC also digs codes out of words).
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const push = (t: Token) => (typeof t === "string" && typeof out[out.length - 1] === "string" ? (out[out.length - 1] += t) : out.push(t));
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (part.length > 1 && /^[\x21-\x7e]+$/.test(part) && positions[part.toLowerCase()]) push({ emoji: part.toLowerCase(), text: part });
    else for (const piece of part.split(unicodeEmoji)) if (piece) push(positions[piece] ? { emoji: piece, text: piece } : piece);
  }
  return out;
}

// Zalo PC's sticker suggestion (getSuggestionFromSentencesV1): the last line before the caret, its last
// `maxWords` words, longest suffix first, raw lowercase then without accents.
export function matchStickerKeyword(text: string, caret: number, keywords: Set<string>, maxWords: number) {
  if (!text || text.startsWith("#")) return "";
  const line = text.slice(0, caret).split("\n").pop()!.trim().toLowerCase();
  if (!line) return "";
  const raw = line.split(" ").slice(-maxWords);
  const stripped = fold(line).split(" ").slice(-maxWords);
  while (raw.length) {
    const a = raw.join(" ");
    const b = stripped.join(" ");
    if (keywords.has(a)) return a;
    if (keywords.has(b)) return b;
    raw.shift();
    stripped.shift();
  }
  return "";
}

// Text cut at its mention ranges; ranges that overlap or run past the text stay plain text.
export function splitMentions(text: string, mentions: Mention[] | null | undefined) {
  const out: (string | { text: string; uid: string })[] = [];
  let at = 0;
  for (const m of [...(mentions ?? [])].sort((a, b) => a.pos - b.pos)) {
    if (m.pos < at || m.pos + m.len > text.length) continue;
    if (m.pos > at) out.push(text.slice(at, m.pos));
    out.push({ text: text.slice(m.pos, m.pos + m.len), uid: m.uid });
    at = m.pos + m.len;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

// Mentions to send: each picked "@Name" located in the final text, so edits after picking don't matter and
// deleted ones drop out. Longest names first, so "@An" never claims the "@Anh" someone else was picked for.
export function findMentions(text: string, picked: { uid: string; name: string }[]): Mention[] {
  const taken = new Set<number>();
  const out: Mention[] = [];
  for (const { uid, name } of [...picked].sort((a, b) => b.name.length - a.name.length)) {
    const tag = `@${name}`;
    let pos = text.indexOf(tag);
    while (pos >= 0 && taken.has(pos)) pos = text.indexOf(tag, pos + 1);
    if (pos < 0) continue;
    taken.add(pos);
    out.push({ uid, pos, len: tag.length });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

// Text cut into runs that do / don't match the query's words, compared without tones, đ or case as message search
// does, so "pho" marks "Phở"
export function markWords(text: string, q: string) {
  const words = fold(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => [...w]);
  const chars = [...text];
  const folded = chars.map(fold);
  const hit = chars.map(() => false);
  for (const w of words)
    for (let i = 0; i + w.length <= chars.length; i++) if (w.every((c, j) => folded[i + j] === c)) w.forEach((_, j) => (hit[i + j] = true));
  const out: { text: string; hit: boolean }[] = [];
  chars.forEach((c, i) => (out.length && out[out.length - 1].hit === hit[i] ? (out[out.length - 1].text += c) : out.push({ text: c, hit: hit[i] })));
  return out;
}

const codesOf = (m: string | undefined) => (m ? m.split(",") : []);
const joinCodes = (list: string[]) => [...new Set(list)].sort().join(",");
// codes that apply to whole lines
const LINE_CODE = /^(lst|ind)_/;

export function marksFrom(text: string, styles: TextStyle[] | null | undefined): Marks {
  const marks: string[][] = Array.from({ length: text.length }, () => []);
  for (const s of styles ?? []) for (let i = Math.max(0, s.start); i < Math.min(text.length, s.start + s.len); i++) marks[i].push(...s.st.split(","));
  return marks.map(joinCodes);
}

export function stylesFrom(marks: Marks): TextStyle[] {
  const out: TextStyle[] = [];
  marks.forEach((m, i) => {
    const last = out[out.length - 1];
    if (!m) return;
    if (last && last.st === m && last.start + last.len === i) last.len++;
    else out.push({ start: i, len: 1, st: m });
  });
  return out;
}

// marks after the text changed from `before` to `after`; typed characters take the marks of the one before them
export function editMarks(marks: Marks, before: string, after: string): Marks {
  const old = before.length === marks.length ? marks : Array<string>(before.length).fill("");
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return [...old.slice(0, p), ...Array<string>(after.length - p - s).fill(old[p - 1] ?? ""), ...old.slice(before.length - s)];
}

// Toolbar action on [from, to): b/i/u/s toggle; c_/f_ set one color / size (a bare "c_" / "f_" = default);
// lst_ toggles bullets / numbering on the whole lines touched
export function toggleMark(marks: Marks, text: string, from: number, to: number, code: string): Marks {
  if (LINE_CODE.test(code)) {
    from = text.lastIndexOf("\n", from - 1) + 1;
    const end = text.indexOf("\n", Math.max(from, to - 1));
    to = end < 0 ? text.length : end;
  }
  if (from >= to) return marks;
  const group = /^[a-z]+_/.exec(code)?.[0];
  const value = code === group ? undefined : code;
  // line codes leave the line breaks alone, so each line is its own run
  const skip = (i: number) => i < from || i >= to || (LINE_CODE.test(code) && text[i] === "\n");
  const has = !!value && marks.every((m, i) => skip(i) || codesOf(m).includes(value));
  return marks.map((m, i) => (skip(i) ? m : joinCodes([...codesOf(m).filter((c) => (group ? !c.startsWith(group) : c !== code)), ...(value && !has ? [value] : [])])));
}

// The text as lines of segments with one style and at most one mention each; a line's list / indent codes come from
// its first character
export function formatLines(text: string, marks: Marks, mentions?: Mention[] | null): Line[] {
  const valid: Mention[] = [];
  for (const m of [...(mentions ?? [])].sort((a, b) => a.pos - b.pos))
    if (m.pos >= (valid.length ? valid[valid.length - 1].pos + valid[valid.length - 1].len : 0) && m.pos + m.len <= text.length) valid.push(m);
  const cuts = new Set([0, text.length]);
  for (let i = 1; i < text.length; i++) if (marks[i] !== marks[i - 1]) cuts.add(i);
  for (const m of valid) (cuts.add(m.pos), cuts.add(m.pos + m.len));
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") (cuts.add(i), cuts.add(i + 1));
  const points = [...cuts].sort((a, b) => a - b);
  const lines: Line[] = [{ codes: codesOf(marks[0]), segments: [] }];
  for (let k = 0; k + 1 < points.length; k++) {
    const [a, b] = [points[k], points[k + 1]];
    if (text[a] === "\n") lines.push({ codes: codesOf(marks[b]), segments: [] });
    else lines[lines.length - 1].segments.push({ text: text.slice(a, b), codes: codesOf(marks[a]), uid: valid.find((m) => a >= m.pos && a < m.pos + m.len)?.uid });
  }
  return lines;
}

// Zalo PC's getLastActiveText for the 1-1 header: within user_active_time (3 min) "Vừa truy cập", then minutes, hours,
// yesterday, then the date. PC counts "hôm qua" by UTC days; local days here.
const ACTIVE = 180_000;
export function lastSeen(t: number, now: number) {
  if (now - t <= -ACTIVE) return "";
  if (now - t <= ACTIVE) return "Vừa truy cập";
  const s = Math.floor(now / 1000) - Math.floor(t / 1000);
  if (s < 3600) return `Truy cập ${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `Truy cập ${Math.floor(s / 3600)} giờ trước`;
  const d = new Date(t);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Truy cập hôm qua";
  return `Truy cập ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

// Zalo PC's quick message trigger: the word right before the caret is "/" or "/" + letters and digits; returns what
// follows the "/", or undefined
export function slashQuery(text: string, caret: number) {
  const word = text.slice(0, caret).replace(/[\u200b-\u200d\ufeff]/g, "").split(/[ \n\t]/).pop() ?? "";
  return /^\/[A-Za-z0-9]*$/.test(word) ? word.slice(1) : undefined;
}

// PC's matching: all (newest first, as given) for a bare "/", else keywords starting with the query, case and accents
// ignored, the closest in length first, then by keyword
export function matchQuick<T extends { keyword: string }>(items: T[], query: string) {
  if (!query) return items;
  const q = fold(query);
  return items
    .filter((i) => fold(i.keyword).startsWith(q))
    .sort((a, b) => a.keyword.length - b.keyword.length || a.keyword.localeCompare(b.keyword));
}
