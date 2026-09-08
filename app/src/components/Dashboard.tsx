import { useMemo } from 'react'
import { statsBy } from '../store'
import type { Attempt, Question } from '../types'

function pct(x: number): string {
  return `${Math.round(x * 100)}%`
}

function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

function Bar({ value }: { value: number }) {
  const tone =
    value >= 0.8 ? 'bg-emerald-500' : value >= 0.6 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${value * 100}%` }} />
    </div>
  )
}

function Table({
  title,
  label,
  rows,
  empty,
}: {
  title: string
  label: string
  rows: { key: string; attempted: number; correct: number; accuracy: number; medianMs: number }[]
  empty: string
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
                <th className="pb-1.5 font-medium">{label}</th>
                <th className="pb-1.5 text-right font-medium">Done</th>
                <th className="pb-1.5 text-right font-medium">Accuracy</th>
                <th className="w-32 pb-1.5 pl-3 font-medium" />
                <th className="pb-1.5 text-right font-medium">Median</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-3">{r.key}</td>
                  <td className="py-2 text-right tabular-nums text-slate-500">
                    {r.correct}/{r.attempted}
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium">{pct(r.accuracy)}</td>
                  <td className="py-2 pl-3">
                    <Bar value={r.accuracy} />
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-500">
                    {fmtMs(r.medianMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function Dashboard({
  attempts,
  byId,
  total,
}: {
  attempts: Attempt[]
  byId: Map<string, Question>
  total: number
}) {
  const bySkill = useMemo(
    () => statsBy(attempts, (id) => byId.get(id)?.skill ?? null),
    [attempts, byId],
  )
  const byDomain = useMemo(
    () => statsBy(attempts, (id) => byId.get(id)?.domain ?? null),
    [attempts, byId],
  )
  const byDifficulty = useMemo(
    () => statsBy(attempts, (id) => byId.get(id)?.difficulty ?? null),
    [attempts, byId],
  )

  const unique = new Set(attempts.map((a) => a.questionId)).size
  const overall = bySkill.reduce(
    (acc, r) => ({ c: acc.c + r.correct, n: acc.n + r.attempted }),
    { c: 0, n: 0 },
  )

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Answered" value={String(attempts.length)} />
        <Stat label="Questions seen" value={`${unique} / ${total}`} />
        <Stat
          label="Accuracy"
          value={overall.n ? pct(overall.c / overall.n) : '—'}
        />
        <Stat
          label="Time on task"
          value={fmtMs(attempts.reduce((s, a) => s + a.ms, 0))}
        />
      </div>

      <Table
        title="By skill — weakest first"
        label="Skill"
        rows={bySkill}
        empty="Answer a few questions and this fills in."
      />
      <Table title="By domain" label="Domain" rows={byDomain} empty="Nothing yet." />
      <Table title="By difficulty" label="Difficulty" rows={byDifficulty} empty="Nothing yet." />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {value}
      </div>
    </div>
  )
}
