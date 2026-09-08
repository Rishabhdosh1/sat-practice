import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dashboard } from './components/Dashboard'
import { Desmos } from './components/Desmos'
import { FiltersPanel } from './components/FiltersPanel'
import { QuestionView } from './components/QuestionView'
import { applyFilters, countActive, type FilterContext } from './lib/filter'
import {
  exportHistory,
  FILTERS_STORAGE_KEY,
  parseHistory,
  seenQuestionIds,
  statsBy,
  useAttempts,
  useNamedSets,
  usePersisted,
  wrongQuestionIds,
} from './store'
import { EMPTY_FILTERS, type Dataset, type Filters, type Question } from './types'

/** Deterministic shuffle so a given seed always yields the same order. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let s = seed || 1
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

type View = 'practice' | 'dashboard'

export default function App() {
  const [data, setData] = useState<Dataset | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<View>('practice')
  const [showFilters, setShowFilters] = useState(false)
  const [showCalc, setShowCalc] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [seed, setSeed] = useState(1)

  const [filters, setFilters] = usePersisted<Filters>(FILTERS_STORAGE_KEY, EMPTY_FILTERS)
  const { attempts, record, merge, clear } = useAttempts()
  const { sets, save: saveSet, remove: removeSet } = useNamedSets()

  const sessionStart = useRef(Date.now())
  const [sessionMs, setSessionMs] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setSessionMs(Date.now() - sessionStart.current), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    fetch('/data/questions.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch((e) =>
        setLoadError(`Could not load questions.json (${e.message}). Run: python3 -m ingest.run`),
      )
  }, [])

  const all = useMemo(() => data?.questions ?? [], [data])
  const byId = useMemo(() => new Map(all.map((q) => [q.id, q])), [all])

  const seen = useMemo(() => seenQuestionIds(attempts), [attempts])
  const wrong = useMemo(() => wrongQuestionIds(attempts), [attempts])

  const ctx: FilterContext = useMemo(() => ({ seen, wrong, sets }), [seen, wrong, sets])

  const matched = useMemo(() => {
    const out = applyFilters(all, filters, ctx)
    return filters.shuffle ? shuffled(out, seed) : out
  }, [all, filters, ctx, seed])

  // The skill with the lowest accuracy, offered as a one-tap drill preset.
  const weakestSkill = useMemo(() => {
    const rows = statsBy(attempts, (id) => byId.get(id)?.skill ?? null).filter(
      (r) => r.attempted >= 3,
    )
    return rows.length ? rows[0].key : null
  }, [attempts, byId])

  // Keep the cursor inside the (possibly shrunken) result set.
  useEffect(() => {
    setCursor((c) => (matched.length ? Math.min(c, matched.length - 1) : 0))
  }, [matched.length])

  const current: Question | undefined = matched[cursor]

  const onSubmit = useCallback(
    (answer: string, correct: boolean, ms: number) => {
      if (!current) return
      record({ questionId: current.id, answer, correct, ms, at: new Date().toISOString() })
    },
    [current, record],
  )

  const onNext = useCallback(() => {
    setCursor((c) => (c + 1 < matched.length ? c + 1 : c))
  }, [matched.length])

  function doExport() {
    const blob = new Blob([exportHistory(attempts, sets)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sat-history-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function doImport(file: File) {
    file
      .text()
      .then((t) => {
        const { attempts: inc } = parseHistory(t)
        merge(inc)
        alert(`Imported ${inc.length} attempts.`)
      })
      .catch((e) => alert(`Import failed: ${e.message}`))
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg p-8 text-sm text-red-700">
        <h1 className="mb-2 text-base font-semibold">Data not loaded</h1>
        <p>{loadError}</p>
      </div>
    )
  }

  if (!data) return <div className="p-8 text-sm text-slate-500">Loading questions…</div>

  return (
    <div className="min-h-full bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2.5">
          <h1 className="text-sm font-semibold">SAT practice</h1>
          <nav className="ml-2 flex gap-1">
            {(['practice', 'dashboard'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded px-2 py-1 text-xs capitalize ${
                  view === v
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {v}
              </button>
            ))}
          </nav>
          <span className="ml-auto tabular-nums text-xs text-slate-500">{fmtClock(sessionMs)}</span>
          <button
            onClick={() => setShowFilters((s) => !s)}
            className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600"
          >
            Filters
            {countActive(filters) > 0 && (
              <span className="ml-1 rounded-full bg-slate-900 px-1.5 text-[10px] text-white dark:bg-white dark:text-slate-900">
                {countActive(filters)}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className="max-h-[70vh] overflow-y-auto border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
            <div className="mx-auto max-w-3xl px-4 py-4">
              <FiltersPanel
                all={all}
                filters={filters}
                ctx={ctx}
                weakestSkill={weakestSkill}
                setFilters={(f) => {
                  if (f.shuffle && !filters.shuffle) setSeed(Date.now() % 100000)
                  setFilters(f)
                  setCursor(0)
                }}
                matched={matched}
                sets={sets}
                onSaveSet={(name) =>
                  saveSet(
                    name,
                    matched.map((q) => q.id),
                  )
                }
                onDeleteSet={removeSet}
              />
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-700">
                <button
                  onClick={doExport}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 dark:border-slate-600"
                >
                  Export history ({attempts.length})
                </button>
                <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 dark:border-slate-600">
                  Import history
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) doImport(f)
                      e.target.value = ''
                    }}
                  />
                </label>
                <button
                  onClick={() => {
                    if (confirm(`Delete all ${attempts.length} recorded attempts?`)) clear()
                  }}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-red-700 dark:border-red-800 dark:text-red-400"
                >
                  Clear history
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {view === 'dashboard' ? (
        <Dashboard attempts={attempts} byId={byId} total={all.length} />
      ) : current ? (
        <QuestionView
          key={current.id}
          question={current}
          index={cursor}
          total={matched.length}
          onSubmit={onSubmit}
          onNext={onNext}
          showCalculator={showCalc}
          onToggleCalculator={() => setShowCalc((s) => !s)}
        />
      ) : (
        <div className="mx-auto max-w-3xl px-4 py-12 text-sm text-slate-500">
          <p className="mb-2 font-medium text-slate-700 dark:text-slate-200">
            No questions match these filters.
          </p>
          <button
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600"
          >
            Reset filters
          </button>
        </div>
      )}

      {showCalc && current?.section === 'math' && <Desmos onClose={() => setShowCalc(false)} />}
    </div>
  )
}
