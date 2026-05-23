'use client'

import { useEffect, useState } from 'react'
import { Mail, MessageCircle } from 'lucide-react'
import { Eyebrow } from '@/components/landing/landing-ui'
import { SITE } from '@/lib/site'

/**
 * A content block inside a legal section. A bare string is a paragraph; a
 * `{ subheading }` renders an inline heading; `{ bullets }` renders a list.
 * Bullet strings may use " — " to bold the lead-in (e.g. "Account data — …").
 */
export type LegalBlock = string | { subheading: string } | { bullets: string[] }

export type LegalSection = {
  id: string
  heading: string
  blocks: LegalBlock[]
}

function Bullet({ text }: { text: string }) {
  const idx = text.indexOf(' — ')
  const lead = idx >= 0 ? text.slice(0, idx) : null
  const rest = idx >= 0 ? text.slice(idx + 3) : text
  return (
    <li className="flex gap-3">
      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--p-1)' }} />
      <span className="text-sm leading-relaxed sm:text-[15px]" style={{ color: 'var(--text-2)' }}>
        {lead && <strong className="font-semibold text-foreground">{lead}</strong>}
        {lead ? ' — ' : ''}
        {rest}
      </span>
    </li>
  )
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === 'string') {
    return (
      <p className="text-sm leading-relaxed sm:text-[15px]" style={{ color: 'var(--text-2)' }}>
        {block}
      </p>
    )
  }
  if ('subheading' in block) {
    return <h3 className="pt-1 text-base font-semibold text-foreground">{block.subheading}</h3>
  }
  return (
    <ul className="space-y-2.5">
      {block.bullets.map((b, i) => (
        <Bullet key={i} text={b} />
      ))}
    </ul>
  )
}

export function LegalDoc({
  eyebrow,
  title,
  intro,
  updated,
  contactEmail,
  sections,
}: {
  eyebrow: string
  title: string
  intro: string
  updated: string
  contactEmail: string
  sections: LegalSection[]
}) {
  // Append a Contact section so every legal page ends with actionable contact
  // info that's also in the table of contents.
  const tocItems = [...sections.map((s) => ({ id: s.id, heading: s.heading })), { id: 'contact', heading: 'Contact' }]
  const [active, setActive] = useState(sections[0]?.id ?? 'contact')

  // Scroll-spy: highlight the section nearest the top of the viewport. Ids are
  // derived from `sections` inside the effect so it only depends on that prop.
  useEffect(() => {
    const ids = [...sections.map((s) => s.id), 'contact']
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)
    if (els.length === 0) return
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    )
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [sections])

  return (
    <div className="mx-auto max-w-6xl px-6 pb-14 pt-10 sm:pb-20 sm:pt-14">
      <header className="max-w-3xl">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">{title}</h1>
        <p className="mt-3 text-sm" style={{ color: 'var(--text-3)' }}>
          Last updated {updated}
        </p>
        <p className="mt-5 text-base leading-relaxed" style={{ color: 'var(--text-2)' }}>
          {intro}
        </p>
      </header>

      <div className="mt-14 grid gap-12 lg:grid-cols-[220px_1fr]">
        {/* Table of contents */}
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1" aria-label="On this page">
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              On this page
            </p>
            {tocItems.map((t, i) => {
              const isActive = active === t.id
              return (
                <a
                  key={t.id}
                  href={`#${t.id}`}
                  className="block rounded-lg border-l-2 px-3 py-1.5 text-sm transition-colors"
                  style={{
                    borderColor: isActive ? 'var(--p-1)' : 'transparent',
                    color: isActive ? 'var(--text)' : 'var(--text-3)',
                    background: isActive ? 'var(--p-soft)' : 'transparent',
                  }}
                >
                  <span className="mr-2 font-mono text-xs" style={{ color: 'var(--text-3)' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {t.heading}
                </a>
              )
            })}
          </nav>
        </aside>

        {/* Sections */}
        <div className="min-w-0 space-y-12">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2 className="flex items-baseline gap-3 text-xl font-bold tracking-tight text-foreground">
                <span className="font-mono text-sm" style={{ color: 'var(--p-1)' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                {s.heading}
              </h2>
              <div className="mt-4 space-y-3.5">
                {s.blocks.map((b, j) => (
                  <Block key={j} block={b} />
                ))}
              </div>
            </section>
          ))}

          {/* Contact */}
          <section id="contact" className="scroll-mt-24">
            <h2 className="flex items-baseline gap-3 text-xl font-bold tracking-tight text-foreground">
              <span className="font-mono text-sm" style={{ color: 'var(--p-1)' }}>
                {String(sections.length + 1).padStart(2, '0')}
              </span>
              Contact
            </h2>
            <p className="mt-4 text-sm leading-relaxed sm:text-[15px]" style={{ color: 'var(--text-2)' }}>
              Questions about this page or your data? Reach us by email or through our Discord community.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <a
                href={`mailto:${contactEmail}`}
                className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all active:translate-y-px"
                style={{
                  background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
                  color: '#fff',
                  boxShadow: '0 6px 20px -6px var(--p-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
                }}
              >
                <Mail size={16} />
                {contactEmail}
              </a>
              <a
                href={SITE.discordInvite}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all active:translate-y-px"
                style={{ background: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--line-strong)' }}
              >
                <MessageCircle size={16} />
                Join our Discord
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
