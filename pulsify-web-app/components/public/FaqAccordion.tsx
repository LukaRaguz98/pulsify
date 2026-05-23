'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export type QA = { q: string; a: React.ReactNode }

/**
 * Generic accordion used for FAQ shortcuts and troubleshooting lists. Mirrors
 * the landing FAQ styling (single-open, animated grid-rows reveal).
 */
export function FaqAccordion({ items, defaultOpen = 0 }: { items: QA[]; defaultOpen?: number | null }) {
  const [open, setOpen] = useState<number | null>(defaultOpen)

  return (
    <div className="space-y-3">
      {items.map((f, i) => {
        const isOpen = open === i
        return (
          <div
            key={f.q}
            className="overflow-hidden rounded-xl border transition-colors"
            style={{ background: 'var(--panel)', borderColor: isOpen ? 'var(--p-1)' : 'var(--line-strong)' }}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="text-sm font-semibold text-foreground">{f.q}</span>
              <ChevronDown
                size={18}
                className="shrink-0 transition-transform duration-200"
                style={{ color: 'var(--p-1)', transform: isOpen ? 'rotate(180deg)' : 'none' }}
              />
            </button>
            <div className="grid transition-all duration-200" style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}>
              <div className="overflow-hidden">
                <p className="px-5 pb-4 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  {f.a}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
