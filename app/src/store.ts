import { useCallback, useEffect, useState } from 'react'
import type { Attempt, NamedSet } from './types'

const ATTEMPTS_KEY = 'sat.attempts.v1'
const SETS_KEY = 'sat.sets.v1'
const FILTERS_KEY = 'sat.filters.v1'
const CURSOR_KEY = 'sat.cursor.v1'
const SEED_KEY = 'sat.seed.v1'

/** localStorage can throw outright (private mode, blocked site data), so every
 *  read and write is guarded and falls back to in-memory state. */
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* history is best-effort; never break the session over a failed write */
  }
}

export function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => read(key, initial))
  useEffect(() => {
    write(key, value)
  }, [key, value])
  return [value, setValue] as const
}

export function useAttempts() {
  const [attempts, setAttempts] = usePersisted<Attempt[]>(ATTEMPTS_KEY, [])

  const record = useCallback(
    (a: Attempt) => setAttempts((prev) => [...prev, a]),
    [setAttempts],
  )

  const clear = useCallback(() => setAttempts([]), [setAttempts])

  /** Merge imported attempts, de-duplicating on (questionId, at). */
  const merge = useCallback(
    (incoming: Attempt[]) => {
      setAttempts((prev) => {
        const seen = new Set(prev.map((a) => `${a.questionId}|${a.at}`))
        const added = incoming.filter((a) => !seen.has(`${a.questionId}|${a.at}`))
        return [...prev, ...added].sort((a, b) => a.at.localeCompare(b.at))
      })
    },
    [setAttempts],
  )

  return { attempts, record, clear, merge, setAttempts }
}

export function useNamedSets() {
  const [sets, setSets] = usePersisted<NamedSet[]>(SETS_KEY, [])

  const save = useCallback(
    (name: string, questionIds: string[]) => {
      setSets((prev) => {
        const rest = prev.filter((s) => s.name !== name)
        return [...rest, { name, questionIds, createdAt: new Date().toISOString() }].sort(
          (a, b) => a.name.localeCompare(b.name),
        )
      })
    },
    [setSets],
  )

  const remove = useCallback(
    (name: string) => setSets((prev) => prev.filter((s) => s.name !== name)),
    [setSets],
  )

  return { sets, save, remove, setSets }
}

export const FILTERS_STORAGE_KEY = FILTERS_KEY
/** Id of the question last on screen, so a relaunch resumes where you left off. */
export const CURSOR_STORAGE_KEY = CURSOR_KEY
/** Shuffle seed, persisted so a shuffled run keeps its order across launches —
 *  otherwise the saved question would sit at a different index every time. */
export const SEED_STORAGE_KEY = SEED_KEY

// ------------------------------------------------------------------ derived

export type SkillStat = {
  key: string
  attempted: number
  correct: number
  accuracy: number
  medianMs: number
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

/** Accuracy per key, counting only the most recent attempt per question so
 *  re-drilling a question you now know doesn't inflate the number. */
export function statsBy(
  attempts: Attempt[],
  keyOf: (questionId: string) => string | null,
): SkillStat[] {
  const latest = new Map<string, Attempt>()
  for (const a of attempts) {
    const prev = latest.get(a.questionId)
    if (!prev || a.at > prev.at) latest.set(a.questionId, a)
  }

  const buckets = new Map<string, Attempt[]>()
  for (const a of latest.values()) {
    const key = keyOf(a.questionId)
    if (!key) continue
    const list = buckets.get(key)
    if (list) list.push(a)
    else buckets.set(key, [a])
  }

  return [...buckets.entries()]
    .map(([key, list]) => {
      const correct = list.filter((a) => a.correct).length
      return {
        key,
        attempted: list.length,
        correct,
        accuracy: list.length ? correct / list.length : 0,
        medianMs: median(list.map((a) => a.ms)),
      }
    })
    .sort((a, b) => a.accuracy - b.accuracy || b.attempted - a.attempted)
}

/** Question ids answered wrong on their most recent attempt. */
export function wrongQuestionIds(attempts: Attempt[]): Set<string> {
  const latest = new Map<string, Attempt>()
  for (const a of attempts) {
    const prev = latest.get(a.questionId)
    if (!prev || a.at > prev.at) latest.set(a.questionId, a)
  }
  return new Set([...latest.values()].filter((a) => !a.correct).map((a) => a.questionId))
}

export function seenQuestionIds(attempts: Attempt[]): Set<string> {
  return new Set(attempts.map((a) => a.questionId))
}

// ------------------------------------------------------------------- export

export function exportHistory(attempts: Attempt[], sets: NamedSet[]): string {
  return JSON.stringify(
    { kind: 'sat-practice-history', version: 1, exportedAt: new Date().toISOString(), attempts, sets },
    null,
    2,
  )
}

export type ImportResult = { attempts: Attempt[]; sets: NamedSet[] }

export function parseHistory(json: string): ImportResult {
  const data = JSON.parse(json)
  if (!data || typeof data !== 'object') throw new Error('not an object')
  const attempts = Array.isArray(data.attempts) ? data.attempts : []
  const sets = Array.isArray(data.sets) ? data.sets : []
  for (const a of attempts) {
    if (typeof a.questionId !== 'string' || typeof a.correct !== 'boolean') {
      throw new Error('attempts are malformed')
    }
  }
  return { attempts, sets }
}
