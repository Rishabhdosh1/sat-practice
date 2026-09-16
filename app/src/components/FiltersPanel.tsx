import { useMemo, useState } from 'react'
import {
  countActive,
  facetCounts,
  facetUniverse,
  skillsByDomain,
  VALUE_OF,
  type FilterContext,
} from '../lib/filter'
import { EMPTY_FILTERS, type Filters, type NamedSet, type Question } from '../types'

const SECTION_LABEL: Record<string, string> = {
  reading_writing: 'Reading & Writing',
  math: 'Math',
}

const DIFFICULTY_ORDER = ['easy', 'medium', 'hard', '(none)']

function Option({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  const dead = count === 0 && !active
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={dead}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
        active
          ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
          : dead
            ? 'cursor-not-allowed border-slate-200 text-slate-300 dark:border-slate-800 dark:text-slate-700'
            : 'border-slate-300 text-slate-700 hover:border-slate-500 dark:border-slate-600 dark:text-slate-300'
      }`}
    >
      <span>{label}</span>
      <span className={active ? 'opacity-70' : 'text-slate-400'}>{count}</span>
    </button>
  )
}

function Section({
  title,
  count,
  children,
  defaultOpen = true,
  onClear,
}: {
  title: string
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
  onClear?: () => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-slate-200 py-2.5 last:border-0 dark:border-slate-800">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          <span className={`transition ${open ? 'rotate-90' : ''}`}>›</span>
          {title}
          {count > 0 && (
            <span className="rounded-full bg-slate-900 px-1.5 text-[10px] text-white dark:bg-white dark:text-slate-900">
              {count}
            </span>
          )}
        </button>
        {count > 0 && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            clear
          </button>
        )}
      </div>
      {open && <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>}
    </section>
  )
}

export function FiltersPanel({
  all,
  filters,
  setFilters,
  ctx,
  matched,
  sets,
  onSaveSet,
  onDeleteSet,
  weakestSkill,
}: {
  all: Question[]
  filters: Filters
  setFilters: (f: Filters) => void
  ctx: FilterContext
  matched: Question[]
  sets: NamedSet[]
  onSaveSet: (name: string) => void
  onDeleteSet: (name: string) => void
  weakestSkill: string | null
}) {
  const [skillQuery, setSkillQuery] = useState('')

  function toggle(key: 'sections' | 'domains' | 'skills' | 'difficulties' | 'tags' | 'sets', value: string) {
    const list = filters[key]
    setFilters({
      ...filters,
      [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
    })
  }

  /** Whether the filters are already narrowed to exactly this one domain. */
  function isOnlyDomain(domain: string): boolean {
    return (
      filters.domains.length === 1 && filters.domains[0] === domain && filters.skills.length === 0
    )
  }

  /**
   * Drop everything else and practise a single domain — the "I'm weak at
   * Expression of Ideas, give me only those" move. The Domain list below
   * *adds* to the current selection, which is right for building a set but
   * wrong when what you want is one topic and nothing else.
   */
  function focusDomain(domain: string) {
    setFilters({
      ...EMPTY_FILTERS,
      shuffle: filters.shuffle,
      domains: isOnlyDomain(domain) ? [] : [domain],
    })
  }

  const counts = useMemo(
    () => ({
      sections: facetCounts(all, filters, ctx, 'sections', VALUE_OF.sections),
      domains: facetCounts(all, filters, ctx, 'domains', VALUE_OF.domains),
      skills: facetCounts(all, filters, ctx, 'skills', VALUE_OF.skills),
      difficulties: facetCounts(all, filters, ctx, 'difficulties', VALUE_OF.difficulties),
      tags: facetCounts(all, filters, ctx, 'tags', VALUE_OF.tags),
    }),
    [all, filters, ctx],
  )

  const universe = useMemo(
    () => ({
      sections: facetUniverse(all, VALUE_OF.sections),
      domains: facetUniverse(all, VALUE_OF.domains),
      difficulties: DIFFICULTY_ORDER.filter((d) =>
        facetUniverse(all, VALUE_OF.difficulties).includes(d),
      ),
      tags: facetUniverse(all, VALUE_OF.tags),
    }),
    [all],
  )

  const byDomain = useMemo(() => skillsByDomain(all), [all])

  /** Totals ignoring the active filters — a focus button clears them anyway, so
   *  a contextual count would promise a number you aren't about to get. */
  const domainTotals = useMemo(
    () => facetCounts(all, EMPTY_FILTERS, ctx, 'domains', VALUE_OF.domains),
    [all, ctx],
  )

  // When domains are selected, only show their skills — otherwise every skill.
  const visibleDomains = filters.domains.length
    ? [...byDomain.keys()].filter((d) => filters.domains.includes(d))
    : [...byDomain.keys()]

  const active = countActive(filters)

  const pills: { label: string; onRemove: () => void }[] = [
    ...filters.sections.map((v) => ({
      label: SECTION_LABEL[v] ?? v,
      onRemove: () => toggle('sections', v),
    })),
    ...filters.domains.map((v) => ({ label: v, onRemove: () => toggle('domains', v) })),
    ...filters.skills.map((v) => ({ label: v, onRemove: () => toggle('skills', v) })),
    ...filters.difficulties.map((v) => ({ label: v, onRemove: () => toggle('difficulties', v) })),
    ...filters.tags.map((v) => ({ label: v, onRemove: () => toggle('tags', v) })),
    ...filters.sets.map((v) => ({ label: `set: ${v}`, onRemove: () => toggle('sets', v) })),
    ...(filters.unseenOnly
      ? [{ label: 'unseen only', onRemove: () => setFilters({ ...filters, unseenOnly: false }) }]
      : []),
    ...(filters.wrongOnly
      ? [{ label: 'my mistakes', onRemove: () => setFilters({ ...filters, wrongOnly: false }) }]
      : []),
    ...(filters.hideUnverified
      ? [
          {
            label: 'official only',
            onRemove: () => setFilters({ ...filters, hideUnverified: false }),
          },
        ]
      : []),
  ]

  const presets: { label: string; hint: string; apply: () => void; on: boolean }[] = [
    {
      label: 'Unseen',
      hint: 'never answered',
      on: filters.unseenOnly,
      apply: () =>
        setFilters({ ...filters, unseenOnly: !filters.unseenOnly, wrongOnly: false }),
    },
    {
      label: 'My mistakes',
      hint: 'latest attempt wrong',
      on: filters.wrongOnly,
      apply: () => setFilters({ ...filters, wrongOnly: !filters.wrongOnly, unseenOnly: false }),
    },
    {
      label: 'Hard only',
      hint: '',
      on: filters.difficulties.length === 1 && filters.difficulties[0] === 'hard',
      apply: () =>
        setFilters({
          ...filters,
          difficulties:
            filters.difficulties.length === 1 && filters.difficulties[0] === 'hard'
              ? []
              : ['hard'],
        }),
    },
    {
      label: 'Official only',
      hint: 'verified answers',
      on: filters.hideUnverified,
      apply: () => setFilters({ ...filters, hideUnverified: !filters.hideUnverified }),
    },
  ]

  if (weakestSkill) {
    presets.push({
      label: `Drill ${weakestSkill}`,
      hint: 'your weakest',
      on: filters.skills.length === 1 && filters.skills[0] === weakestSkill,
      apply: () =>
        setFilters({
          ...EMPTY_FILTERS,
          shuffle: filters.shuffle,
          skills: filters.skills.length === 1 && filters.skills[0] === weakestSkill ? [] : [weakestSkill],
        }),
    })
  }

  return (
    <div className="text-sm">
      {/* result count + reset ------------------------------------------- */}
      <div className="sticky top-0 z-10 -mx-4 mb-1 flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {matched.length}
        </span>
        <span className="text-xs text-slate-500">of {all.length} questions</span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={filters.shuffle}
            onChange={(e) => setFilters({ ...filters, shuffle: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-400"
          />
          Shuffle
        </label>
        {active > 0 && (
          <button
            type="button"
            onClick={() => setFilters({ ...EMPTY_FILTERS, shuffle: filters.shuffle })}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs dark:border-slate-600"
          >
            Reset
          </button>
        )}
      </div>

      {/* active filter pills --------------------------------------------- */}
      {pills.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5 pt-1">
          {pills.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={p.onRemove}
              className="flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-xs text-white dark:bg-white dark:text-slate-900"
            >
              {p.label}
              <span className="opacity-60">×</span>
            </button>
          ))}
        </div>
      )}

      {/* presets ---------------------------------------------------------- */}
      <div className="mb-1 flex flex-wrap gap-1.5 pt-1">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={p.apply}
            title={p.hint}
            className={`rounded-lg border px-2.5 py-1 text-xs transition ${
              p.on
                ? 'border-sky-600 bg-sky-600 text-white'
                : 'border-slate-300 text-slate-700 hover:border-slate-500 dark:border-slate-600 dark:text-slate-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* one tap to a single topic --------------------------------------- */}
      <section className="border-b border-slate-200 py-2.5 dark:border-slate-800">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Practise one topic
        </div>
        <div className="flex flex-wrap gap-1.5">
          {universe.domains.map((d) => {
            const on = isOnlyDomain(d)
            return (
              <button
                key={d}
                type="button"
                onClick={() => focusDomain(d)}
                title={on ? 'Back to everything' : `Only ${d} — clears other filters`}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                  on
                    ? 'border-sky-600 bg-sky-600 text-white'
                    : 'border-slate-300 text-slate-700 hover:border-slate-500 dark:border-slate-600 dark:text-slate-300'
                }`}
              >
                {d}
                <span className={on ? 'opacity-70' : 'text-slate-400'}>
                  {domainTotals.get(d) ?? 0}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <Section
        title="Section"
        count={filters.sections.length}
        onClear={() => setFilters({ ...filters, sections: [] })}
      >
        {universe.sections.map((v) => (
          <Option
            key={v}
            label={SECTION_LABEL[v] ?? v}
            count={counts.sections.get(v) ?? 0}
            active={filters.sections.includes(v)}
            onClick={() => toggle('sections', v)}
          />
        ))}
      </Section>

      <Section
        title="Difficulty"
        count={filters.difficulties.length}
        onClear={() => setFilters({ ...filters, difficulties: [] })}
      >
        {universe.difficulties.map((v) => (
          <Option
            key={v}
            label={v === '(none)' ? 'unlabelled' : v}
            count={counts.difficulties.get(v) ?? 0}
            active={filters.difficulties.includes(v)}
            onClick={() => toggle('difficulties', v)}
          />
        ))}
      </Section>

      <Section
        title="Domain"
        count={filters.domains.length}
        onClear={() => setFilters({ ...filters, domains: [], skills: [] })}
      >
        {universe.domains.map((v) => (
          <Option
            key={v}
            label={v}
            count={counts.domains.get(v) ?? 0}
            active={filters.domains.includes(v)}
            onClick={() => toggle('domains', v)}
          />
        ))}
      </Section>

      {/* skills, grouped under their domain ------------------------------- */}
      <Section
        title="Skill"
        count={filters.skills.length}
        onClear={() => setFilters({ ...filters, skills: [] })}
      >
        <div className="w-full">
          <input
            value={skillQuery}
            onChange={(e) => setSkillQuery(e.target.value)}
            placeholder="Find a skill…"
            className="mb-2 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
          />
          {visibleDomains.map((domain) => {
            const skills = (byDomain.get(domain) ?? []).filter((s) =>
              s.toLowerCase().includes(skillQuery.toLowerCase()),
            )
            if (!skills.length) return null
            return (
              <div key={domain} className="mb-2.5">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
                  {domain}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((s) => (
                    <Option
                      key={s}
                      label={s}
                      count={counts.skills.get(s) ?? 0}
                      active={filters.skills.includes(s)}
                      onClick={() => toggle('skills', s)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      <Section
        title="Source"
        count={filters.tags.length}
        defaultOpen={false}
        onClear={() => setFilters({ ...filters, tags: [] })}
      >
        {universe.tags.map((v) => (
          <Option
            key={v}
            label={v}
            count={counts.tags.get(v) ?? 0}
            active={filters.tags.includes(v)}
            onClick={() => toggle('tags', v)}
          />
        ))}
      </Section>

      <Section
        title="My sets"
        count={filters.sets.length}
        defaultOpen={sets.length > 0}
        onClear={() => setFilters({ ...filters, sets: [] })}
      >
        {sets.length === 0 ? (
          <p className="text-xs text-slate-400">
            Filter to a selection, then save it below to come back to it later.
          </p>
        ) : (
          sets.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-0.5">
              <Option
                label={s.name}
                count={s.questionIds.length}
                active={filters.sets.includes(s.name)}
                onClick={() => toggle('sets', s.name)}
              />
              <button
                type="button"
                onClick={() => onDeleteSet(s.name)}
                title={`Delete "${s.name}"`}
                className="px-1 text-xs text-slate-400 hover:text-red-600"
              >
                ×
              </button>
            </span>
          ))
        )}
        <button
          type="button"
          onClick={() => {
            const name = prompt(`Name this set of ${matched.length} questions:`)
            if (name?.trim()) onSaveSet(name.trim())
          }}
          disabled={!matched.length}
          className="rounded-full border border-dashed border-slate-400 px-2.5 py-1 text-xs text-slate-600 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300"
        >
          + Save these {matched.length}
        </button>
      </Section>
    </div>
  )
}
