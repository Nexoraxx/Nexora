import { VARIABLES, PATTERN, FALLBACK } from '../constants/template.constant'
import type { Variable, Person } from '../models/template.model'

export const isVariable = (k: string): k is Variable => (VARIABLES as readonly string[]).includes(k)

// {{key | filter | filter}}: the filters pick the words, then shape them (see renderToken). The editor lists the same ones
// (apps/Nexora/src/app/bulk-send/constants/bulk-send.constants.ts FILTERS).
const up = (s: string) => s.toLocaleUpperCase('vi')
const CASE: Record<string, (s: string) => string> = {
  upper: up,
  lower: (s) => s.toLocaleLowerCase('vi'),
  // first letter, and the first after each "/": anh/chị → Anh/Chị
  cap: (s) => s.replace(/(^\s*|\/\s*)(\p{L})/gu, (_, at: string, c: string) => at + up(c)),
  // every word: lan nguyễn → Lan Nguyễn
  title: (s) => s.replace(/(^|[\s/])(\p{L})/gu, (_, at: string, c: string) => at + up(c)),
  // a word of the name: "Nguyễn Văn Lan" → first "Nguyễn", last "Lan" (the given name)
  first: (s) => s.trim().split(/\s+/)[0] ?? '',
  last: (s) => s.trim().split(/\s+/).at(-1) ?? '',
}
// or:text, the value when empty; male/female (pronoun only), the words for each gender: "ông/bà", "Anh/Chị"
type Step = ((s: string) => string) | { or: string } | { male: string; female: string; either: string }
type Token = { key: string; steps: Step[]; error?: string }

// Vietnamese writes some pairs male first (anh/chị, ông/bà) and some female first (cô/chú): a pair whose words are
// known goes either way; an unknown one reads male first
const FEMALE = new Set(['chị', 'cô', 'bà', 'dì', 'mợ', 'thím', 'mẹ', 'nàng', 'em gái', 'quý bà', 'nữ'])
const MALE = new Set(['anh', 'chú', 'ông', 'cậu', 'dượng', 'bố', 'chàng', 'em trai', 'quý ông', 'nam'])
function genders(a: string, b: string) {
  const female = (w: string) => FEMALE.has(w.toLocaleLowerCase('vi'))
  const male = (w: string) => MALE.has(w.toLocaleLowerCase('vi'))
  // either: an unknown gender gets the pair as written
  const either = `${a}/${b}`
  return female(a) && !female(b) && (male(b) || !male(a)) ? { male: b, female: a, either } : { male: a, female: b, either }
}

function parse(inner: string): Token {
  const [key = '', ...filters] = inner.split('|').map((s) => s.trim())
  const steps: Step[] = []
  for (const f of filters) {
    const fn = CASE[f.toLowerCase()]
    const or = /^or:(.*)$/is.exec(f)
    const pair = /^([^/]+)\/([^/]+)$/.exec(f)
    if (fn) steps.push(fn)
    else if (or) steps.push({ or: or[1]!.trim() })
    else if (pair && key === 'pronoun') steps.push(genders(pair[1]!.trim(), pair[2]!.trim()))
    else
      return {
        key,
        steps,
        error: pair
          ? `"${f}" chỉ dùng được với {{pronoun}} (xưng hô theo giới tính), không dùng với {{${key}}}`
          : `Không hiểu "${f}" trong {{${inner.trim()}}}: xem các cách viết trong mục "Muốn viết hoa tên…" bên dưới ô soạn`,
      }
  }
  return { key, steps }
}

const tokens = (body: string) => [...body.matchAll(PATTERN)].map((m) => parse(m[1]!))

export const variablesIn = (body: string) => [...new Set(tokens(body).map((t) => t.key))]
export const unknownVariables = (body: string) => variablesIn(body).filter((k) => !isVariable(k))
// what makes a body unsendable: unknown {{keys}}, then unknown filters
export function problemsIn(body: string) {
  const bad = unknownVariables(body)
  return [
    ...(bad.length ? [`Không có biến ${bad.map((k) => `{{${k}}}`).join(', ')}: kiểm tra chính tả, hoặc bấm các nút biến bên dưới ô soạn để chèn`] : []),
    ...new Set(tokens(body).flatMap((t) => (t.error ? [t.error] : []))),
  ]
}

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

function renderToken(t: Token, values: Record<Variable, string>) {
  if (t.error || !isVariable(t.key)) return ''
  const raw = values[t.key]
  // the built-in fallback ("anh/chị") stands in only when the filters bring no words of their own
  let v = raw || (t.steps.some((s) => typeof s === 'object') ? '' : (FALLBACK[t.key] ?? ''))
  // the words are picked first (a nam/nữ pair, an or: default), then shaped (cap, upper, last…): the order they're
  // written in doesn't matter, {{pronoun | cap | cô/chú}} is "Cô" like {{pronoun | cô/chú | cap}}
  const picks = t.steps.filter((s) => typeof s === 'object')
  const shapes = t.steps.filter((s) => typeof s === 'function')
  for (const s of picks)
    v =
      'or' in s ? v || s.or
      // pronoun's raw value says the gender: "anh" male, "chị" female, "" unknown
      : raw === 'anh' ? s.male
      : raw === 'chị' ? s.female
      : s.either
  for (const shape of shapes) v = shape(v)
  return v
}

export const render = (body: string, values: Record<Variable, string>) => body.replace(PATTERN, (_, inner: string) => renderToken(parse(inner), values))

// the variables this body uses that have no value for this person (an "or:" default counts as a value)
export const missingIn = (body: string, values: Record<Variable, string>) => [
  ...new Set(tokens(body).flatMap((t) => (isVariable(t.key) && !values[t.key] && !t.steps.some((s) => typeof s === 'object' && 'or' in s) ? [t.key] : []))),
]
