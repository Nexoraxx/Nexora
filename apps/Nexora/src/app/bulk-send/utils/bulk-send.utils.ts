import { VARIABLES } from "@/app/bulk-send/constants/bulk-send.constants";
import { fold } from "@/shared/utils/text.utils";

// as the server: spaces inside the braces are fine
const PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

export const unknownVariables = (body: string) => [...new Set([...body.matchAll(PATTERN)].map((m) => m[1]))].filter((k) => !VARIABLES.some((v) => v.key === k));

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
