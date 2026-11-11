import { CASE_FILTERS, FILTER_GROUPS, VARIABLES } from "@/app/bulk-send/constants/bulk-send.constants";
import { fold } from "@/shared/utils/text.utils";

// as the server: spaces inside the braces are fine
const PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

// {{key | filter | ...}}: its key and filters
const tokens = (body: string) => [...body.matchAll(PATTERN)].map((m) => ({ inner: m[1], parts: m[1].split("|").map((s) => s.trim()) }));

// as the server refuses them: unknown keys, then unknown filters (a "nam/nữ" pair only on pronoun)
export function problemsIn(body: string) {
  const bad = [...new Set(tokens(body).map((t) => t.parts[0]))].filter((k) => !VARIABLES.some((v) => v.key === k));
  // the first problem of each token, as the server stops at it
  const filters = tokens(body).flatMap(({ inner, parts: [key, ...fs] }) => {
    for (const f of fs) {
      if (CASE_FILTERS.includes(f.toLowerCase()) || /^or:/i.test(f)) continue;
      if (/^[^/]+\/[^/]+$/.test(f)) {
        if (key === "pronoun") continue;
        return [`"${f}" chỉ dùng được với {{pronoun}} (xưng hô theo giới tính), không dùng với {{${key}}}`];
      }
      return [`Không hiểu "${f}" trong {{${inner.trim()}}}: xem các cách viết trong mục "Muốn viết hoa tên…" bên dưới ô soạn`];
    }
    return [];
  });
  return [
    ...(bad.length ? [`Không có biến ${bad.map((k) => `{{${k}}}`).join(", ")}: kiểm tra chính tả, hoặc bấm các nút biến bên dưới ô soạn để chèn`] : []),
    ...new Set(filters),
  ];
}

// a filter clicked: added to the {{variable}} the caret is in or right after, else a new {{key | filter}} at the caret
export function addFilter(text: string, caret: number, filter: string, key: string) {
  const at = [...text.matchAll(PATTERN)].find((m) => m.index < caret && caret <= m.index + m[0].length);
  if (!at) return insertVariable(text, caret, caret, `${key} | ${filter}`);
  const token = `{{${at[1]} | ${filter}}}`;
  return { text: text.slice(0, at.index) + token + text.slice(at.index + at[0].length), caret: at.index + token.length };
}

// "{{key |" (any filters already in between) and what follows the last "|" right before the caret: the filter typed
// so far and where it starts
export function filterQuery(text: string, caret: number) {
  const m = /\{\{\s*([\p{L}_]+)\s*(?:\|[^{}|\n]*)*\|\s*([^{}|\n]*)$/u.exec(text.slice(0, caret));
  return m ? { key: m[1], query: m[2], start: caret - m[2].length } : undefined;
}

type FilterRow = (typeof FILTER_GROUPS)[number]["rows"][number];
// the filters that fit this variable (a nam/nữ pair only on pronoun), by their code or their short name, accents
// optional ("hoa" finds the "Viết hoa…" ones; notes are left out, "thoại" would match "hoa" too)
export const matchFilters = (key: string, query: string) =>
  FILTER_GROUPS.flatMap((g): readonly FilterRow[] => g.rows)
    .filter((r) => key === "pronoun" || !r.insert.includes("/"))
    .filter((r) => r.insert.startsWith(query.toLowerCase()) || fold(r.label).includes(fold(query)));

// text[start, end) becomes the filter; the token's "}}" is added when it isn't closed yet
export function insertFilter(text: string, start: number, end: number, filter: string) {
  const rest = text.slice(end);
  const token = filter + (/^[^{}\n]*\}\}/.test(rest) ? "" : "}}");
  return { text: text.slice(0, start) + token + rest, caret: start + token.length };
}

// "{" (or "{{") and what follows it right before the caret: the part of a key typed so far, and where the brace starts
export function variableQuery(text: string, caret: number) {
  const m = /\{\{?\s*([\p{L}_]*)$/u.exec(text.slice(0, caret));
  return m ? { query: m[1], start: m.index } : undefined;
}

// by key, or by the Vietnamese label with accents optional ("{{ten" finds "Tên Zalo của khách")
export const matchVariables = (query: string) => VARIABLES.filter((v) => v.key.startsWith(query.toLowerCase()) || fold(v.label).includes(fold(query)));

// text[start, end) becomes {{key}}; a "}" or "}}" typed ahead right after is taken in
export function insertVariable(text: string, start: number, end: number, key: string) {
  const token = `{{${key}}}`;
  return { text: text.slice(0, start) + token + text.slice(end).replace(/^\s*\}{1,2}/, ""), caret: start + token.length };
}

export function duration(seconds: number) {
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ${m % 60 ? ` ${m % 60} phút` : ""}`;
}
