import type { AutoReply } from "@/shared/types";
import { H, MIN, DAY } from "@/app/settings/constants/auto-reply.constants";

const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (ms: number) => `${pad(Math.floor(ms / H) % 24)}:${pad(Math.floor((ms % H) / MIN))}`;

export const timeOfDay = (t: number) => t - new Date(t).setHours(0, 0, 0, 0);
// a rule's daily window back as times of day
export const windowOf = (r: AutoReply) => (r.endTime - r.startTime >= DAY ? { start: 0, end: 0 } : { start: timeOfDay(r.startTime), end: timeOfDay(r.endTime) });
