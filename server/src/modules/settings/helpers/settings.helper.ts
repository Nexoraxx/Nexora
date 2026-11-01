import type { Settings } from '../dtos/responses/settings.response'

export const normalize = (s: Record<string, unknown>): Settings =>
  Object.fromEntries(Object.entries(s).flatMap(([k, v]) => (typeof v === 'boolean' ? [[k, Number(v)]] : typeof v === 'number' ? [[k, v]] : [])))
