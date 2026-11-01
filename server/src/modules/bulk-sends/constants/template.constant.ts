import type { Variable } from '../models/template.model'

// {{variable}} templates of "Gửi hàng loạt". Keys are English; the editor shows them with Vietnamese labels
// (apps/Nexora/src/app/bulk-send/constants/bulk-send.constants.ts keeps the same list).
export const VARIABLES = ['name', 'alias', 'pronoun', 'phone', 'me'] as const

// spaces inside the braces are fine: {{ name }} = {{name}}
export const PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g

export const FALLBACK: Partial<Record<Variable, string>> = { pronoun: 'anh/chị' }
