// <input type="datetime-local"> works in local time
export const toLocal = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
export const when = (ms: number) => new Date(ms).toLocaleString("vi", { hour: "2-digit", minute: "2-digit", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
