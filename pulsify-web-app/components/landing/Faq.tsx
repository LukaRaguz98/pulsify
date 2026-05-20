'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { FAQS } from './landing-data'
import { SectionHeading } from './landing-ui'

export function Faq() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section id="faq" className="lp-anchor mx-auto max-w-3xl px-6 py-16">
      <SectionHeading
        eyebrow="FAQ"
        title="Questions, answered"
        subtitle="Everything you need to know before inviting Pulse to your server."
      />

      <div className="mt-12 space-y-3">
        {FAQS.map((f, i) => {
          const isOpen = open === i
          return (
            <div
              key={f.q}
              className="overflow-hidden rounded-xl border transition-colors"
              style={{
                background: 'var(--panel)',
                borderColor: isOpen ? 'var(--p-1)' : 'var(--line-strong)',
              }}
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
              <div
                className="grid transition-all duration-200"
                style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
              >
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
    </section>
  )
}
