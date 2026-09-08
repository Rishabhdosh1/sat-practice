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
  onPrev,
  showCalculator,
  onToggleCalculator,
}: {
  question: Question
  index: number
  total: number
  onSubmit: (answer: string, correct: boolean, ms: number) => void
  onNext: () => void
  onPrev: () => void
  showCalculator: boolean
  onToggleCalculator: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [gridIn, setGridIn] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const started = useRef(Date.now())
  const scroller = useRef<HTMLDivElement>(null)
  const isMath = question.section === 'math'
  const isGridIn = question.response_type === 'grid_in'

  useEffect(() => {
    setSelected(null)
    setGridIn('')
    setSubmitted(false)
    setElapsed(0)
    started.current = Date.now()
    scroller.current?.scrollTo({ top: 0 })
  }, [question.id])

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        if (e.key === 'Enter') submit()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key >= '1' && e.key <= '5' && !submitted && !isGridIn) {
        const i = Number(e.key) - 1
        if (i < question.choices.length) setSelected(question.choices[i].label)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (submitted) onNext()
        else submit()
      } else if (e.key.toLowerCase() === 'n' && submitted) {
        onNext()
      } else if (e.key === 'ArrowRight' && submitted) {
        onNext()
      } else if (e.key === 'ArrowLeft') {
        onPrev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const correct = submitted && grade()

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* progress ------------------------------------------------------- */}
      <div className="h-0.5 shrink-0 bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full bg-slate-900 transition-all dark:bg-slate-300"
          style={{ width: `${total ? ((index + 1) / total) * 100 : 0}%` }}
        />
      </div>

      {/* scrolling body -------------------------------------------------- */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto w-full max-w-[46rem] px-5 py-5 sm:px-8">
          <header className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">
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
            {question.source.trust !== 'official' && <Badge tone="amber">unofficial answer</Badge>}
            <span className="ml-auto tabular-nums">{fmtMs(elapsed)}</span>
          </header>

          {question.figures.map((f) => (
            <img
              key={f.path}
              src={`/${f.path}`}
              alt={f.alt ?? 'Figure for this question'}
              className="mb-5 w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700"
            />
          ))}

          {question.stimulus && (
            <RichText
              value={question.stimulus}
              className="mb-4 whitespace-pre-wrap text-[15.5px] leading-[1.65] text-slate-800 dark:text-slate-200"
            />
          )}

          <RichText
            value={question.stem}
            className="mb-4 text-[15.5px] font-semibold leading-[1.6] text-slate-900 dark:text-slate-100"
          />

          {isGridIn ? (
            <input
              value={gridIn}
              onChange={(e) => setGridIn(e.target.value)}
              disabled={submitted}
              placeholder="Your answer"
              inputMode="decimal"
              className="w-52 rounded-lg border border-slate-300 px-3 py-2.5 text-base disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:disabled:bg-slate-900"
            />
          ) : (
            <ul className="space-y-2">
              {question.choices.map((c, i) => {
                const isPicked = selected === c.label
                const isAnswer = question.correct.labels.includes(c.label)
                let cls =
                  'border-slate-300 hover:border-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-500 dark:hover:bg-slate-900'
                if (submitted && isAnswer) {
                  cls = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
                } else if (submitted && isPicked) {
                  cls = 'border-red-500 bg-red-50 dark:bg-red-950/40'
                } else if (isPicked) {
                  cls = 'border-sky-500 bg-sky-50 ring-1 ring-sky-500 dark:bg-sky-950/40'
                }
                return (
                  <li key={c.label}>
                    <button
                      type="button"
                      onClick={() => !submitted && setSelected(c.label)}
                      disabled={submitted}
                      className={`choice-btn flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left text-[15px] leading-relaxed transition ${cls}`}
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
                  correct
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-red-700 dark:text-red-300'
                }`}
              >
                {correct ? 'Correct' : 'Incorrect'}
                {!correct && (
                  <span className="ml-2 font-normal text-slate-600 dark:text-slate-400">
                    Answer:{' '}
                    {isGridIn
                      ? question.correct.values.join(' or ')
                      : question.correct.labels.join(', ')}
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
        </article>
      </div>

      {/* action bar — part of the layout, not floating over it ----------- */}
      <div className="shrink-0 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex w-full max-w-[46rem] items-center gap-2 px-5 py-3 sm:px-8">
          <button
            onClick={onPrev}
            disabled={index === 0}
            title="Previous (←)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300"
          >
            ←
          </button>
          {isMath && (
            <button
              onClick={onToggleCalculator}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
            >
              {showCalculator ? 'Hide calc' : 'Desmos'}
            </button>
          )}
          <span className="hidden text-xs text-slate-400 sm:block">
            {submitted ? 'Enter or N for next' : '1–4 to choose · Enter to submit'}
          </span>
          {!submitted ? (
            <button
              onClick={submit}
              disabled={isGridIn ? !gridIn.trim() : !selected}
              className="ml-auto rounded-lg bg-slate-900 px-6 py-2 text-sm font-medium text-white transition disabled:opacity-30 dark:bg-white dark:text-slate-900"
            >
              Submit
            </button>
          ) : (
            <button
              onClick={onNext}
              disabled={index + 1 >= total}
              className="ml-auto rounded-lg bg-slate-900 px-6 py-2 text-sm font-medium text-white disabled:opacity-30 dark:bg-white dark:text-slate-900"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
