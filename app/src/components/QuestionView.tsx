import { useEffect, useRef, useState } from 'react'
import { RichText } from '../lib/RichText'
import type { Question } from '../types'

const LETTERS = ['A', 'B', 'C', 'D', 'E']

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
    green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
    red: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  }
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function QuestionView({
  question,
  index,
  total,
  onSubmit,
  onNext,
  showCalculator,
  onToggleCalculator,
}: {
  question: Question
  index: number
  total: number
  onSubmit: (answer: string, correct: boolean, ms: number) => void
  onNext: () => void
  showCalculator: boolean
  onToggleCalculator: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [gridIn, setGridIn] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const started = useRef(Date.now())
  const isMath = question.section === 'math'
  const isGridIn = question.response_type === 'grid_in'

  // Reset per question.
  useEffect(() => {
    setSelected(null)
    setGridIn('')
    setSubmitted(false)
    setElapsed(0)
    started.current = Date.now()
  }, [question.id])

  // Per-question timer, frozen once submitted.
  useEffect(() => {
    if (submitted) return
    const t = setInterval(() => setElapsed(Date.now() - started.current), 250)
    return () => clearInterval(t)
  }, [submitted, question.id])

  function grade(): boolean {
    if (isGridIn) {
      const norm = (s: string) => s.trim().replace(/\s+/g, '')
      return question.correct.values.some((v) => norm(v) === norm(gridIn))
    }
    return !!selected && question.correct.labels.includes(selected)
  }

  function submit() {
    if (submitted) return
    const answer = isGridIn ? gridIn.trim() : (selected ?? '')
    if (!answer) return
    const ms = Date.now() - started.current
    setElapsed(ms)
    setSubmitted(true)
    onSubmit(answer, grade(), ms)
  }

  // Keyboard: 1-4 pick a choice, Enter submits, N advances.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        if (e.key === 'Enter') submit()
        return
      }
      if (e.key >= '1' && e.key <= '5' && !submitted && !isGridIn) {
        const i = Number(e.key) - 1
        if (i < question.choices.length) setSelected(question.choices[i].label)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (submitted) onNext()
        else submit()
      } else if (e.key.toLowerCase() === 'n' && submitted) {
        onNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const correct = submitted && grade()

  return (
    <article className="mx-auto w-full max-w-3xl px-4 pb-40 pt-4">
      <header className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {index + 1} / {total}
        </span>
        {question.skill && <Badge>{question.skill}</Badge>}
        {question.difficulty && (
          <Badge
            tone={
              question.difficulty === 'hard'
                ? 'red'
                : question.difficulty === 'medium'
                  ? 'amber'
                  : 'green'
            }
          >
            {question.difficulty}
          </Badge>
        )}
        {question.source.trust !== 'official' && (
          <Badge tone="amber" >unofficial answer</Badge>
        )}
        <span className="ml-auto tabular-nums">{fmtMs(elapsed)}</span>
      </header>

      {question.figures.map((f) => (
        <img
          key={f.path}
          src={`/${f.path}`}
          alt={f.alt ?? 'Figure for this question'}
          className="mb-4 w-full rounded border border-slate-200 bg-white dark:border-slate-700"
        />
      ))}

      {question.stimulus && (
        <RichText
          value={question.stimulus}
          className="mb-4 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800 dark:text-slate-200"
        />
      )}

      <RichText
        value={question.stem}
        className="mb-4 text-[15px] font-medium leading-relaxed text-slate-900 dark:text-slate-100"
      />

      {isGridIn ? (
        <input
          value={gridIn}
          onChange={(e) => setGridIn(e.target.value)}
          disabled={submitted}
          placeholder="Your answer"
          inputMode="decimal"
          className="w-48 rounded-lg border border-slate-300 px-3 py-2 text-base disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:disabled:bg-slate-900"
        />
      ) : (
        <ul className="space-y-2">
          {question.choices.map((c, i) => {
            const isPicked = selected === c.label
            const isAnswer = question.correct.labels.includes(c.label)
            let cls =
              'border-slate-300 hover:border-slate-400 dark:border-slate-600 dark:hover:border-slate-500'
            if (submitted && isAnswer) {
              cls = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
            } else if (submitted && isPicked) {
              cls = 'border-red-500 bg-red-50 dark:bg-red-950/40'
            } else if (isPicked) {
              cls = 'border-sky-500 bg-sky-50 dark:bg-sky-950/40'
            }
            return (
              <li key={c.label}>
                <button
                  type="button"
                  onClick={() => !submitted && setSelected(c.label)}
                  disabled={submitted}
                  className={`choice-btn flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-[15px] leading-relaxed transition ${cls}`}
                >
                  <span className="mt-px shrink-0 rounded border border-current px-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {LETTERS[i] ?? c.label}
                  </span>
                  <RichText value={{ text: c.text, format: c.format }} className="flex-1" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {submitted && (
        <section className="mt-5 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <p
            className={`mb-2 text-sm font-semibold ${
              correct ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
            }`}
          >
            {correct ? 'Correct' : 'Incorrect'}
            {!correct && !isGridIn && (
              <span className="ml-2 font-normal text-slate-600 dark:text-slate-400">
                Answer: {question.correct.labels.join(', ')}
              </span>
            )}
            {!correct && isGridIn && (
              <span className="ml-2 font-normal text-slate-600 dark:text-slate-400">
                Answer: {question.correct.values.join(' or ')}
              </span>
            )}
          </p>
          {question.explanation ? (
            <RichText
              value={question.explanation}
              className="whitespace-pre-wrap text-[14px] leading-relaxed text-slate-700 dark:text-slate-300"
            />
          ) : (
            <p className="text-sm text-slate-500">No explanation in the source.</p>
          )}
          <p className="mt-3 text-[11px] text-slate-400">
            {question.id} · {question.source.file}
            {question.source.page ? ` p${question.source.page}` : ''}
          </p>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          {isMath && (
            <button
              onClick={onToggleCalculator}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
            >
              {showCalculator ? 'Hide' : 'Desmos'}
            </button>
          )}
          {!submitted ? (
            <button
              onClick={submit}
              disabled={isGridIn ? !gridIn.trim() : !selected}
              className="ml-auto rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
            >
              Submit <span className="opacity-60">⏎</span>
            </button>
          ) : (
            <button
              onClick={onNext}
              className="ml-auto rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-900"
            >
              Next <span className="opacity-60">N</span>
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
