import type { Metadata } from 'next'
import Link from 'next/link'
import {
  MessageCircle, Mail, LifeBuoy, Rocket, CreditCard, ShieldAlert, Zap, BarChart3,
  Lock, Bug, Lightbulb, BookOpen, ArrowRight,
} from 'lucide-react'
import { Eyebrow, SectionHeading } from '@/components/landing/landing-ui'
import { Reveal } from '@/components/landing/Reveal'
import { FaqAccordion, type QA } from '@/components/public/FaqAccordion'
import { FAQS } from '@/components/landing/landing-data'
import { SITE } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Support · Pulsify',
  description:
    'Get help with Pulsify — contact options, support categories, FAQ shortcuts, troubleshooting, bug reports and feature requests.',
  alternates: { canonical: '/support' },
}

const CATEGORIES = [
  { icon: Rocket, title: 'Getting started', desc: 'Invite Pulse, sign in and set up your first server.', href: '/#how', accent: 'var(--p-1)' },
  { icon: CreditCard, title: 'Plans & billing', desc: 'Compare plans, upgrades and what each tier includes.', href: '/#pricing', accent: 'var(--amber)' },
  { icon: ShieldAlert, title: 'Moderation & Pulse Guard', desc: 'Tune AI moderation, actions and hierarchy checks.', href: '#faq', accent: 'var(--pink)' },
  { icon: Zap, title: 'Automations & scheduling', desc: 'Welcome flows, auto-roles and scheduled workflows.', href: '#faq', accent: 'var(--cyan)' },
  { icon: BarChart3, title: 'Analytics & insights', desc: 'Understand member, message and voice activity.', href: '#faq', accent: 'var(--green)' },
  { icon: Lock, title: 'Account & security', desc: 'Permissions, data and disconnecting Discord.', href: '/privacy', accent: 'var(--p-1)' },
]

const TROUBLESHOOTING: QA[] = [
  {
    q: 'The Pulse bot appears offline',
    a: 'Make sure the bot still has a role with the permissions it needs and hasn’t been removed from the server. Re-inviting the bot restores access — the dashboard shows the bot’s effective permissions per server.',
  },
  {
    q: 'My changes aren’t showing up',
    a: 'Most changes sync instantly. If data looks out of date, use the “Trigger server sync” quick action in the dashboard to refresh members and metadata.',
  },
  {
    q: 'I can’t see one of my servers',
    a: 'You only see servers where you have Manage Server or Administrator and where the Pulse bot is present. If your session expired, reconnect Discord from the dashboard.',
  },
  {
    q: 'Pulse Guard isn’t acting on messages',
    a: 'Confirm Pulse Guard is enabled, the relevant categories have an action set, and the bot can read and manage messages in those channels.',
  },
  {
    q: 'A moderation action failed',
    a: 'Discord requires the bot’s highest role to sit above the target member, and the bot can’t action the server owner. Check the role hierarchy and the bot’s permissions.',
  },
]

const PRIMARY_BTN =
  'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all active:translate-y-px'
const SECONDARY_BTN =
  'inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all active:translate-y-px'
const primaryStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
  color: '#fff',
  boxShadow: '0 6px 20px -6px var(--p-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
}
const secondaryStyle: React.CSSProperties = {
  background: 'var(--panel)',
  color: 'var(--text)',
  borderColor: 'var(--line-strong)',
}

export default function SupportPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-14 pt-10 sm:pb-20 sm:pt-14">
      {/* Hero */}
      <header className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <Eyebrow>Support</Eyebrow>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">How can we help?</h1>
        <p className="mt-5 text-base leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Find answers fast, troubleshoot common issues, or reach the team. We’re most active in our Discord community.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a href={SITE.discordInvite} target="_blank" rel="noopener noreferrer" className={PRIMARY_BTN} style={primaryStyle}>
            <MessageCircle size={16} />
            Ask the community
          </a>
          <a href={`mailto:${SITE.infoEmail}`} className={SECONDARY_BTN} style={secondaryStyle}>
            <Mail size={16} />
            Email support
          </a>
        </div>
      </header>

      {/* Contact methods */}
      <Reveal className="mt-20">
        <div className="grid gap-5 md:grid-cols-3">
          <ContactCard
            icon={<MessageCircle size={20} />}
            title="Discord community"
            desc="The fastest way to get help — from the team and other Pulsify admins."
            actionLabel="Join the Discord"
            href={SITE.discordInvite}
            external
            accent="var(--p-1)"
          />
          <ContactCard
            icon={<Mail size={20} />}
            title="Email support"
            desc="For account, billing and privacy questions that need a private channel."
            actionLabel={SITE.infoEmail}
            href={`mailto:${SITE.infoEmail}`}
            accent="var(--cyan)"
          />
          <ContactCard
            icon={<BookOpen size={20} />}
            title="Browse the FAQ"
            desc="Quick answers to the most common questions about Pulsify and Pulse."
            actionLabel="Jump to FAQ"
            href="#faq"
            accent="var(--amber)"
          />
        </div>
      </Reveal>

      {/* Support categories */}
      <Reveal className="mt-20">
        <SectionHeading eyebrow="Topics" title="Browse by category" subtitle="Pick a topic to find the right resources." />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((c) => {
            const isAnchor = c.href.startsWith('#')
            const inner = (
              <>
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-xl"
                  style={{ background: `color-mix(in srgb, ${c.accent} 14%, transparent)`, color: c.accent }}
                >
                  <c.icon size={20} />
                </span>
                <h3 className="mt-4 text-base font-semibold text-foreground">{c.title}</h3>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{c.desc}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--p-1)' }}>
                  Learn more <ArrowRight size={14} />
                </span>
              </>
            )
            const className = 'lp-card flex flex-col rounded-2xl border p-6'
            const style: React.CSSProperties = { background: 'var(--panel)', borderColor: 'var(--line-strong)' }
            return isAnchor ? (
              <a key={c.title} href={c.href} className={className} style={style}>{inner}</a>
            ) : (
              <Link key={c.title} href={c.href} className={className} style={style}>{inner}</Link>
            )
          })}
        </div>
      </Reveal>

      {/* FAQ shortcuts */}
      <Reveal className="mt-20">
        <section id="faq" className="scroll-mt-24">
          <SectionHeading eyebrow="FAQ" title="Frequently asked" subtitle="The questions we hear most often." />
          <div className="mx-auto mt-10 max-w-3xl">
            <FaqAccordion items={FAQS} />
          </div>
        </section>
      </Reveal>

      {/* Troubleshooting */}
      <Reveal className="mt-20">
        <SectionHeading
          eyebrow="Troubleshooting"
          title="Quick fixes"
          subtitle="Most issues come down to one of these — try the fix before reaching out."
        />
        <div className="mx-auto mt-10 max-w-3xl">
          <FaqAccordion items={TROUBLESHOOTING} defaultOpen={null} />
        </div>
      </Reveal>

      {/* Bug report + feature request */}
      <Reveal className="mt-20">
        <div className="grid gap-5 md:grid-cols-2">
          <RequestPanel
            icon={<Bug size={20} />}
            accent="var(--pink)"
            title="Report a bug"
            desc="Found something broken? Tell us what happened so we can fix it fast."
            tips={['What you did and what you expected', 'The server and feature affected', 'Screenshots or error messages, if any']}
            actions={[
              { label: 'Report in Discord', href: SITE.discordInvite, external: true, primary: true },
              { label: 'Email a report', href: `mailto:${SITE.infoEmail}?subject=Bug%20report` },
            ]}
          />
          <RequestPanel
            icon={<Lightbulb size={20} />}
            accent="var(--amber)"
            title="Request a feature"
            desc="Have an idea that would make Pulsify better? We build with the community."
            tips={['The problem you’re trying to solve', 'How you’d expect it to work', 'How often it would help you']}
            actions={[
              { label: 'Suggest in Discord', href: SITE.discordInvite, external: true, primary: true },
              { label: 'Email an idea', href: `mailto:${SITE.infoEmail}?subject=Feature%20request` },
            ]}
          />
        </div>
      </Reveal>

      {/* Final CTA */}
      <Reveal className="mt-20">
        <div
          className="relative overflow-hidden rounded-3xl border px-6 py-14 text-center"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <div
            aria-hidden
            className="lp-blob pointer-events-none absolute -top-24 left-1/2 h-[320px] w-[320px] -translate-x-1/2 rounded-full opacity-50 blur-[120px]"
            style={{ background: 'radial-gradient(circle, var(--p-glow), transparent 70%)' }}
          />
          <div className="relative mx-auto max-w-xl">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ margin: '0 auto', background: 'var(--p-soft)', color: 'var(--p-1)' }}>
              <LifeBuoy size={24} />
            </span>
            <h2 className="mt-5 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Still stuck?</h2>
            <p className="mt-3 text-base" style={{ color: 'var(--text-2)' }}>
              Our community and team are happy to help. Hop into Discord and we’ll get you sorted.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={SITE.discordInvite} target="_blank" rel="noopener noreferrer" className={PRIMARY_BTN} style={primaryStyle}>
                <MessageCircle size={16} />
                Join the community
              </a>
              <a href={`mailto:${SITE.infoEmail}`} className={SECONDARY_BTN} style={secondaryStyle}>
                <Mail size={16} />
                Email us
              </a>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  )
}

function ContactCard({
  icon, title, desc, actionLabel, href, external, accent,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  actionLabel: string
  href: string
  external?: boolean
  accent: string
}) {
  const inner = (
    <>
      <span
        className="flex h-11 w-11 items-center justify-center rounded-xl"
        style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
      >
        {icon}
      </span>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{desc}</p>
      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--p-1)' }}>
        {actionLabel} <ArrowRight size={14} />
      </span>
    </>
  )
  const className = 'lp-card flex flex-col rounded-2xl border p-6'
  const style: React.CSSProperties = { background: 'var(--panel)', borderColor: 'var(--line-strong)' }
  if (href.startsWith('#')) return <a href={href} className={className} style={style}>{inner}</a>
  if (external || href.startsWith('mailto:')) {
    return (
      <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} className={className} style={style}>
        {inner}
      </a>
    )
  }
  return <Link href={href} className={className} style={style}>{inner}</Link>
}

function RequestPanel({
  icon, accent, title, desc, tips, actions,
}: {
  icon: React.ReactNode
  accent: string
  title: string
  desc: string
  tips: string[]
  actions: { label: string; href: string; external?: boolean; primary?: boolean }[]
}) {
  return (
    <div className="flex flex-col rounded-2xl border p-7" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <span
        className="flex h-12 w-12 items-center justify-center rounded-xl"
        style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
      >
        {icon}
      </span>
      <h3 className="mt-4 text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{desc}</p>
      <ul className="mt-4 space-y-2">
        {tips.map((t) => (
          <li key={t} className="flex gap-2.5 text-sm" style={{ color: 'var(--text-2)' }}>
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
            {t}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
        {actions.map((a) => (
          <a
            key={a.label}
            href={a.href}
            target={a.external ? '_blank' : undefined}
            rel={a.external ? 'noopener noreferrer' : undefined}
            className={a.primary ? PRIMARY_BTN : SECONDARY_BTN}
            style={a.primary ? primaryStyle : secondaryStyle}
          >
            {a.label}
          </a>
        ))}
      </div>
    </div>
  )
}
