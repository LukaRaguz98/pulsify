import type { Metadata } from 'next'
import Link from 'next/link'
import { HelpCircle, MessageCircle, LifeBuoy } from 'lucide-react'
import { Eyebrow } from '@/components/landing/landing-ui'
import { Reveal } from '@/components/landing/Reveal'
import { FaqAccordion, type QA } from '@/components/public/FaqAccordion'
import { SITE } from '@/lib/site'

export const metadata: Metadata = {
  title: 'FAQ · Pulsify',
  description:
    'Frequently asked questions about Pulsify and the Pulse bot — setup, permissions, moderation, Pulse Guard, billing, privacy and troubleshooting.',
  alternates: { canonical: '/faq' },
}

type Group = { id: string; category: string; items: QA[] }

const GROUPS: Group[] = [
  {
    id: 'general',
    category: 'General',
    items: [
      {
        q: 'Is Pulsify free to use?',
        a: 'Yes. The Free plan includes core moderation, limited analytics and basic automations — no credit card required. You can upgrade any time as your community grows.',
      },
      {
        q: 'What is the Pulse bot?',
        a: 'Pulse is the Discord bot that powers Pulsify. It syncs your server, runs slash commands, and carries out the moderation and automations you configure from the dashboard.',
      },
      {
        q: 'Do I need to host anything?',
        a: 'No. Invite the Pulse bot, sign in with Discord, and you’re ready. Pulsify is fully managed — there are no config files or servers to run.',
      },
      {
        q: 'Is Pulsify affiliated with Discord?',
        a: 'No. Pulsify is an independent product that integrates with Discord through its official API. “Discord” is a trademark of Discord Inc.',
      },
    ],
  },
  {
    id: 'setup',
    category: 'Setup & permissions',
    items: [
      {
        q: 'How do I add Pulse to my server?',
        a: 'Click “Invite Pulse”, pick your server and authorise it. Then sign in to the dashboard with Discord — every server you manage shows up automatically.',
      },
      {
        q: 'What permissions does the bot need?',
        a: 'Pulse only needs the permissions for the features you use. The dashboard shows the bot’s effective permissions per server and warns you if something it needs is missing.',
      },
      {
        q: 'Why can’t I see one of my servers?',
        a: 'You only see servers where you have Manage Server or Administrator and where the Pulse bot is present. If your session expired, reconnect Discord from the dashboard.',
      },
      {
        q: 'Can I manage more than one server?',
        a: 'Absolutely. Every server you have Manage Server or Administrator on appears automatically. Multi-server management tools are part of the Business plan.',
      },
    ],
  },
  {
    id: 'moderation',
    category: 'Moderation & Pulse Guard',
    items: [
      {
        q: 'How does Pulse Guard (AI moderation) work?',
        a: 'Every message is screened with fast deterministic heuristics first, then an optional AI pass for the fuzzier categories like toxicity and harassment. You choose the sensitivity and the action per category — flag, delete, warn or timeout.',
      },
      {
        q: 'Will Pulse Guard make mistakes?',
        a: 'AI moderation isn’t perfect — it can occasionally over- or under-flag. You control the sensitivity and action per category, and a review queue lets you check decisions, so you always stay in control.',
      },
      {
        q: 'Can I moderate from both the dashboard and Discord?',
        a: 'Yes. Actions taken in either place are attributed to the moderator who made them and appear in your audit log and real-time activity feed.',
      },
    ],
  },
  {
    id: 'billing',
    category: 'Billing & plans',
    items: [
      {
        q: 'Can I change plans or cancel any time?',
        a: 'Yes — upgrade, downgrade or cancel whenever you like. Your settings and data stay intact, and the Free plan is always available to fall back on.',
      },
      {
        q: 'What happens to my data if I cancel?',
        a: 'Your configuration and data remain intact; you simply lose access to paid features until you upgrade again. Removing the bot or deleting your account schedules the associated data for deletion.',
      },
    ],
  },
  {
    id: 'privacy',
    category: 'Privacy & data',
    items: [
      {
        q: 'What data does Pulsify collect?',
        a: (
          <>
            Only what’s needed to run the service — your Discord profile, the servers you manage, and aggregate activity
            used for analytics. We don’t read your members’ private messages. See our{' '}
            <Link href="/privacy" className="font-medium underline" style={{ color: 'var(--p-1)' }}>
              Privacy Policy
            </Link>{' '}
            for the full breakdown.
          </>
        ),
      },
      {
        q: 'How do I delete my data or revoke access?',
        a: (
          <>
            Remove the Pulse bot from a server, or contact us to delete your account data. You can revoke Pulsify’s
            access any time from your Discord settings. More detail is in the{' '}
            <Link href="/privacy" className="font-medium underline" style={{ color: 'var(--p-1)' }}>
              Privacy Policy
            </Link>
            .
          </>
        ),
      },
    ],
  },
  {
    id: 'technical',
    category: 'Troubleshooting',
    items: [
      {
        q: 'My changes aren’t showing up',
        a: 'Most changes sync instantly. If data looks out of date, run /sync in your server, or use the “Trigger server sync” quick action in the dashboard, to refresh members and metadata.',
      },
      {
        q: 'The Pulse bot appears offline',
        a: 'Make sure the bot still has a role with the permissions it needs and hasn’t been removed from the server. Re-inviting the bot restores access.',
      },
    ],
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

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 pb-14 pt-10 sm:pb-20 sm:pt-14">
      {/* Hero */}
      <header className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <Eyebrow>FAQ</Eyebrow>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Frequently asked questions
        </h1>
        <p className="mt-5 text-base leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Everything you need to know about Pulsify and the Pulse bot. Can’t find your answer? We’re happy to help.
        </p>
      </header>

      {/* Category quick-nav */}
      <div className="mt-10 flex flex-wrap justify-center gap-2">
        {GROUPS.map((g) => (
          <a
            key={g.id}
            href={`#${g.id}`}
            className="rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            {g.category}
          </a>
        ))}
      </div>

      {/* Groups */}
      <div className="mt-14 space-y-14">
        {GROUPS.map((g, gi) => (
          <Reveal key={g.id}>
            <section id={g.id} className="scroll-mt-24">
              <h2 className="mb-5 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                <HelpCircle size={14} style={{ color: 'var(--p-1)' }} />
                {g.category}
              </h2>
              <FaqAccordion items={g.items} defaultOpen={gi === 0 ? 0 : null} />
            </section>
          </Reveal>
        ))}
      </div>

      {/* CTA */}
      <Reveal className="mt-16">
        <div
          className="relative overflow-hidden rounded-3xl border px-6 py-12 text-center"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <div
            aria-hidden
            className="lp-blob pointer-events-none absolute -top-24 left-1/2 h-[300px] w-[300px] -translate-x-1/2 rounded-full opacity-50 blur-[120px]"
            style={{ background: 'radial-gradient(circle, var(--p-glow), transparent 70%)' }}
          />
          <div className="relative mx-auto max-w-lg">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
              <LifeBuoy size={24} />
            </span>
            <h2 className="mt-5 text-2xl font-bold tracking-tight text-foreground">Still have questions?</h2>
            <p className="mt-3 text-base" style={{ color: 'var(--text-2)' }}>
              Reach the team and other admins through support or our community.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/support" className={PRIMARY_BTN} style={primaryStyle}>
                <LifeBuoy size={16} />
                Visit support
              </Link>
              <a href={SITE.discordInvite} target="_blank" rel="noopener noreferrer" className={SECONDARY_BTN} style={secondaryStyle}>
                <MessageCircle size={16} />
                Ask the community
              </a>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  )
}
