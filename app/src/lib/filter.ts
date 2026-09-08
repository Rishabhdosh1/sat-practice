import type { Filters, NamedSet, Question } from '../types'

/** Everything the predicate needs that isn't on the question itself. */
export type FilterContext = {
  seen: Set<string>
  wrong: Set<string>
  sets: NamedSet[]
}

export type FacetKey = 'sections' | 'domains' | 'skills' | 'difficulties' | 'tags' | 'sets'

function setIdsFor(filters: Filters, sets: NamedSet[]): Set<string> | null {
  if (!filters.sets.length) return null
  return new Set(
    sets.filter((s) => filters.sets.includes(s.name)).flatMap((s) => s.questionIds),
  )
}

/**
 * Does a question survive the filters?
 *
 * `skip` omits one facet, which is what makes contextual counts possible: the
 * count shown next to an option is how many questions you'd get if you picked
 * it, given everything *else* that's active. Without that the counts are global
 * and you can happily assemble a combination that yields nothing.
 */
export function matches(
  q: Question,
  filters: Filters,
  ctx: FilterContext,
  skip?: FacetKey,
): boolean {
  if (skip !== 'sections' && filters.sections.length && !filters.sections.includes(q.section ?? ''))
    return false
  if (skip !== 'domains' && filters.domains.length && !filters.domains.includes(q.domain ?? ''))
    return false
  if (skip !== 'skills' && filters.skills.length && !filters.skills.includes(q.skill ?? ''))
    return false
  if (
    skip !== 'difficulties' &&
    filters.difficulties.length &&
    !filters.difficulties.includes(q.difficulty ?? '(none)')
  )
    return false
  if (skip !== 'tags' && filters.tags.length && !q.tags.some((t) => filters.tags.includes(t)))
    return false

  if (skip !== 'sets') {
    const ids = setIdsFor(filters, ctx.sets)
    if (ids && !ids.has(q.id)) return false
  }

  if (filters.unseenOnly && ctx.seen.has(q.id)) return false
  if (filters.wrongOnly && !ctx.wrong.has(q.id)) return false
  if (filters.hideUnverified && q.source.trust !== 'official') return false
  return true
}

export function applyFilters(
  all: Question[],
  filters: Filters,
  ctx: FilterContext,
): Question[] {
  return all.filter((q) => matches(q, filters, ctx))
}

/**
 * How many questions each option would yield, given the other active filters.
 * Zero-count options are still returned so the UI can dim rather than hide them
 * — a vanishing option is more confusing than a disabled one.
 */
export function facetCounts(
  all: Question[],
  filters: Filters,
  ctx: FilterContext,
  facet: FacetKey,
  valueOf: (q: Question) => string | string[] | null,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const q of all) {
    if (!matches(q, filters, ctx, facet)) continue
    const v = valueOf(q)
    const values = v === null ? [] : Array.isArray(v) ? v : [v]
    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  return counts
}

/** Every value present in the corpus for a facet, so options never disappear. */
export function facetUniverse(
  all: Question[],
  valueOf: (q: Question) => string | string[] | null,
): string[] {
  const seen = new Set<string>()
  for (const q of all) {
    const v = valueOf(q)
    const values = v === null ? [] : Array.isArray(v) ? v : [v]
    for (const value of values) seen.add(value)
  }
  return [...seen]
}

export const VALUE_OF = {
  sections: (q: Question) => q.section ?? null,
  domains: (q: Question) => q.domain ?? null,
  skills: (q: Question) => q.skill ?? null,
  difficulties: (q: Question) => q.difficulty ?? '(none)',
  tags: (q: Question) => q.tags,
} as const

/** Which domain each skill belongs to, so skills can be grouped under it. */
export function skillsByDomain(all: Question[]): Map<string, string[]> {
  const m = new Map<string, Set<string>>()
  for (const q of all) {
    if (!q.domain || !q.skill) continue
    const s = m.get(q.domain) ?? new Set<string>()
    s.add(q.skill)
    m.set(q.domain, s)
  }
  return new Map([...m.entries()].map(([k, v]) => [k, [...v].sort()]))
}

export function countActive(f: Filters): number {
  return (
    f.sections.length +
    f.domains.length +
    f.skills.length +
    f.difficulties.length +
    f.tags.length +
    f.sets.length +
    (f.unseenOnly ? 1 : 0) +
    (f.wrongOnly ? 1 : 0) +
    (f.hideUnverified ? 1 : 0)
  )
}
