import katex from 'katex'
import { useMemo } from 'react'
import type { RichText as RichTextValue } from '../types'

/**
 * Renders a question's text.
 *
 * The Reading and Writing corpus is plain prose, so the common path is a fast
 * pass-through. Math support is wired up now so a College Board Math export
 * drops in without touching this: `format: 'latex'` renders the whole string,
 * and `$...$` / `\(...\)` spans are picked out of otherwise-plain text.
 */

const INLINE = /\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g

function renderTex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      // Show the offending source rather than blowing up the whole question.
      errorColor: '#b91c1c',
    })
  } catch {
    return escapeHtml(tex)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

/** Light markdown: *emphasis* only, which is all the Latin-roots key uses. */
function renderMarkdownish(s: string): string {
  return escapeHtml(s).replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
}

function toHtml(value: RichTextValue): string {
  if (value.format === 'latex') return renderTex(value.text, false)

  const base = value.format === 'markdown' ? renderMarkdownish : escapeHtml
  if (!INLINE.test(value.text)) {
    INLINE.lastIndex = 0
    return base(value.text)
  }
  INLINE.lastIndex = 0

  let out = ''
  let last = 0
  for (const m of value.text.matchAll(INLINE)) {
    out += base(value.text.slice(last, m.index))
    out += renderTex(m[1] ?? m[2] ?? '', false)
    last = (m.index ?? 0) + m[0].length
  }
  out += base(value.text.slice(last))
  return out
}

export function RichText({
  value,
  className,
}: {
  value: RichTextValue | null | undefined
  className?: string
}) {
  const html = useMemo(() => (value ? toHtml(value) : ''), [value])
  if (!value) return null
  return (
    <div
      className={className}
      // Content is our own ingested corpus, escaped above except for the KaTeX
      // and <em> we generate ourselves.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export function plain(text: string, format: RichTextValue['format'] = 'text') {
  return <RichText value={{ text, format }} />
}
