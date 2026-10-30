export type Token = string | { emoji: string; text: string };

// Zalo mention: pos/len in UTF-16 units over the text, '@' included; uid "-1" (MENTION_ALL) is "@All"
export type Mention = { uid: string; pos: number; len: number; type?: number };

// "Định dạng tin nhắn": Zalo's styles are { start, len, st } over UTF-16 units, st = comma-joined codes (b, i, u, s,
// c_<hex>, f_<px>, ind_<px>, lst_1 bullets, lst_2 numbering). Kept here as one code string per character, so edits
// only splice the array, and sending regroups equal runs as PC's normalizeFormat does.
export type TextStyle = { start: number; len: number; st: string };
export type Marks = string[];

export type Segment = { text: string; codes: string[]; uid?: string };
export type Line = { codes: string[]; segments: Segment[] };
