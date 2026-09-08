import { useEffect, useRef, useState } from 'react'

/**
 * Embeds the Desmos graphing calculator.
 *
 * The script is loaded lazily the first time a math question appears, so a
 * Reading and Writing session never pays for it. `dcb31709b452b1cf9dc26972add0fda6`
 * is Desmos's published demo API key, which is what they document for local and
 * non-commercial use.
 */

const SRC =
  'https://www.desmos.com/api/v1.11/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6'

declare global {
  interface Window {
    Desmos?: {
      GraphingCalculator: (el: HTMLElement, opts?: Record<string, unknown>) => {
        destroy: () => void
      }
    }
  }
}

let loader: Promise<void> | null = null

function loadDesmos(): Promise<void> {
  if (window.Desmos) return Promise.resolve()
  if (loader) return loader
  loader = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Desmos failed to load'))
    document.head.appendChild(s)
  })
  return loader
}

export function Desmos({ onClose }: { onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let calc: { destroy: () => void } | null = null
    let cancelled = false

    loadDesmos()
      .then(() => {
        if (cancelled || !host.current || !window.Desmos) return
        calc = window.Desmos.GraphingCalculator(host.current, {
          expressionsCollapsed: false,
          settingsMenu: false,
          border: false,
        })
      })
      .catch(() => {
        if (!cancelled) setError('Could not load Desmos — check your connection.')
      })

    return () => {
      cancelled = true
      calc?.destroy()
    }
  }, [])

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
          Graphing calculator
        </span>
        <button
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Close
        </button>
      </div>
      {error ? (
        <div className="px-3 pb-3 text-sm text-red-600">{error}</div>
      ) : (
        <div ref={host} className="h-[45vh] w-full" />
      )}
    </div>
  )
}
