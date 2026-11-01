import { VARIABLES, PATTERN, FALLBACK } from '../constants/template.constant'
import type { Variable, Person } from '../models/template.model'

export const isVariable = (k: string): k is Variable => (VARIABLES as readonly string[]).includes(k)

export const variablesIn = (body: string) => [...new Set([...body.matchAll(PATTERN)].map((m) => m[1]))]
export const unknownVariables = (body: string) => variablesIn(body).filter((k) => !isVariable(k))

// a missing value is '' (the preview counts who lacks one); pronoun falls back to "anh/chị", never empty.
// {{name}} skips the alias on purpose: sales notes like "Lan váy đỏ 0912" are not for the customer to read
export function valuesOf(p: Person, me: string): Record<Variable, string> {
  const name = p.displayName || p.zaloName || ''
  return {
    name,
    alias: p.alias || name,
    // zca's Gender: 0 male, 1 female
    pronoun: p.gender === 0 ? 'anh' : p.gender === 1 ? 'chị' : '',
    phone: p.phoneNumber || '',
    me,
  }
}

export const render = (body: string, values: Record<Variable, string>) =>
  body.replace(PATTERN, (_, k: string) => (isVariable(k) ? values[k] || FALLBACK[k] || '' : ''))

// the variables this body uses that have no value for this person
export const missingIn = (body: string, values: Record<Variable, string>) => variablesIn(body).filter((k): k is Variable => isVariable(k) && !values[k])
