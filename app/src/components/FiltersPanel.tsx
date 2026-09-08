import type { Filters, NamedSet, Question } from '../types'

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition ${
        active
          ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
          : 'border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-600 dark:text-slate-300'
      }`}
    >
      {label}
      {count !== undefined && <span className="ml-1 opacity-60">{count}</span>}
    </button>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-400"
      />
      <span>{label}</span>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

function tally(questions: Question[], pick: (q: Question) => string | null | undefined) {
  const m = new Map<string, number>()
  for (const q of questions) {
    const v = pick(q)
    if (v) m.set(v, (m.get(v) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

export function FiltersPanel({
  all,
  filters,
  setFilters,
  matched,
  sets,
  onSaveSet,
  onDeleteSet,
}: {
  all: Question[]
  filters: Filters
  setFilters: (f: Filters) => void
  matched: Question[]
  sets: NamedSet[]
  onSaveSet: (name: string) => void
  onDeleteSet: (name: string) => void
}) {
  function toggle(key: keyof Filters, value: string) {
    const list = filters[key] as string[]
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
    setFilters({ ...filters, [key]: next })
  }

  const sectionLabels: Record<string, string> = {
    reading_writing: 'Reading & Writing',
    math: 'Math',
  }

  return (
    <div className="space-y-4 text-sm">
      <Group title="Section">
        {tally(all, (q) => q.section).map(([v, n]) => (
          <Chip
            key={v}
            label={sectionLabels[v] ?? v}
            count={n}
            active={filters.sections.includes(v)}
            onClick={() => toggle('sections', v)}
          />
        ))}
      </Group>

      <Group title="Domain">
        {tally(all, (q) => q.domain).map(([v, n]) => (
          <Chip
            key={v}
            label={v}
            count={n}
            active={filters.domains.includes(v)}
            onClick={() => toggle('domains', v)}
          />
        ))}
      </Group>

      <Group title="Skill">
        {tally(all, (q) => q.skill).map(([v, n]) => (
          <Chip
            key={v}
            label={v}
            count={n}
            active={filters.skills.includes(v)}
            onClick={() => toggle('skills', v)}
          />
        ))}
      </Group>

      <Group title="Difficulty">
        {['easy', 'medium', 'hard'].map((v) => {
          const n = all.filter((q) => q.difficulty === v).length
          return (
            <Chip
              key={v}
              label={v}
              count={n}
              active={filters.difficulties.includes(v)}
              onClick={() => toggle('difficulties', v)}
            />
          )
        })}
        <Chip
          label="unlabelled"
          count={all.filter((q) => !q.difficulty).length}
          active={filters.difficulties.includes('(none)')}
          onClick={() => toggle('difficulties', '(none)')}
        />
      </Group>

      <Group title="Source set">
        {tally(all, (q) => q.tags[0]).map(([v, n]) => (
          <Chip
            key={v}
            label={v}
            count={n}
            active={filters.tags.includes(v)}
            onClick={() => toggle('tags', v)}
          />
        ))}
      </Group>

      {sets.length > 0 && (
        <Group title="My sets">
          {sets.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1">
              <Chip
                label={s.name}
                count={s.questionIds.length}
                active={filters.sets.includes(s.name)}
                onClick={() => toggle('sets', s.name)}
              />
              <button
                onClick={() => onDeleteSet(s.name)}
                title={`Delete "${s.name}"`}
                className="text-xs text-slate-400 hover:text-red-600"
              >
                ×
              </button>
            </span>
          ))}
        </Group>
      )}

      <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <Toggle
          label="Unseen only"
          checked={filters.unseenOnly}
          onChange={(v) => setFilters({ ...filters, unseenOnly: v, wrongOnly: v ? false : filters.wrongOnly })}
          hint="never answered"
        />
        <Toggle
          label="Review my wrong answers"
          checked={filters.wrongOnly}
          onChange={(v) => setFilters({ ...filters, wrongOnly: v, unseenOnly: v ? false : filters.unseenOnly })}
          hint="latest attempt was wrong"
        />
        <Toggle label="Shuffle" checked={filters.shuffle} onChange={(v) => setFilters({ ...filters, shuffle: v })} />
        <Toggle
          label="Official answers only"
          checked={filters.hideUnverified}
          onChange={(v) => setFilters({ ...filters, hideUnverified: v })}
          hint="hides the Latin-roots set"
        />
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <button
          onClick={() => {
            const name = prompt(`Name this set of ${matched.length} questions:`)
            if (name?.trim()) onSaveSet(name.trim())
          }}
          disabled={!matched.length}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-slate-600"
        >
          Save {matched.length} as a set
        </button>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}
