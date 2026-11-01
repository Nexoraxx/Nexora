// accent-, đ- and case-insensitive, as PC's simpleStripVietnamese
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase()

// PC's contact rule: every keyword (longest first) is the start of a different word of the name
export function nameMatches(names: (string | null | undefined)[], q: string) {
  const keywords = fold(q).split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)
  return (
    keywords.length > 0 &&
    names.some((name) => {
      const words = fold(name ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      const used = new Set<number>()
      return keywords.every((k) => {
        const i = words.findIndex((w, j) => !used.has(j) && w.startsWith(k))
        return i >= 0 && used.add(i)
      })
    })
  )
}
