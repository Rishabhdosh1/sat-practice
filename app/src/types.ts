export type RichText = { text: string; format: 'text' | 'markdown' | 'latex' }

export type Choice = { label: string; text: string; format: RichText['format'] }

export type Figure = {
  kind: string
  path: string
  alt: string | null
  origin: string
}

export type Question = {
  id: string
  source_ids: string[]
  source: {
    file: string
    page: number | null
    tier: string
    trust: 'official' | 'unverified_answer' | 'reconstructed'
  }
  section: 'reading_writing' | 'math' | null
  domain: string | null
  skill: string | null
  difficulty: 'easy' | 'medium' | 'hard' | null
  stimulus: RichText | null
  stem: RichText
  response_type: 'mcq' | 'grid_in'
  choices: Choice[]
  correct: { labels: string[]; values: string[] }
  explanation: RichText | null
  figures: Figure[]
  tags: string[]
  flags: string[]
  needs_review: boolean
}

export type Dataset = {
  schema_version: number
  generator: unknown
  counts: Record<string, unknown>
  questions: Question[]
}

/** One recorded answer. Append-only; a question can be attempted many times. */
export type Attempt = {
  questionId: string
  /** Chosen choice label for mcq, or the typed string for grid-in. */
  answer: string
  correct: boolean
  /** Milliseconds spent on the question before submitting. */
  ms: number
  /** ISO timestamp. */
  at: string
}

export type NamedSet = {
  name: string
  questionIds: string[]
  createdAt: string
}

export type Filters = {
  sections: string[]
  domains: string[]
  skills: string[]
  difficulties: string[]
  tags: string[]
  sets: string[]
  unseenOnly: boolean
  wrongOnly: boolean
  shuffle: boolean
  hideUnverified: boolean
}

/**
 * The no-filters baseline — also what Reset restores.
 *
 * `unseenOnly` starts **on**: the point of the app is to get through the bank
 * once, so a question you have already answered should not come round again
 * unless you ask for it. Reset and "Practise one topic" both carry it (and
 * shuffle) across rather than silently letting 700 answered questions back in.
 */
export const EMPTY_FILTERS: Filters = {
  sections: [],
  domains: [],
  skills: [],
  difficulties: [],
  tags: [],
  sets: [],
  unseenOnly: true,
  wrongOnly: false,
  shuffle: false,
  hideUnverified: false,
}
