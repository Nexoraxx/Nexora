import { DAY } from '../constants/auto-reply.constant'

export function anchor(start: number, end: number, now = Date.now()) {
  const base = new Date(now - DAY).setHours(0, 0, 0, 0)
  const from = base + start
  let to = base + end
  if (Math.abs(end - start) >= DAY || Math.abs(end - start) < 1000) to = from + DAY
  else if (from > to) to += DAY
  return { startTime: from, endTime: to }
}
