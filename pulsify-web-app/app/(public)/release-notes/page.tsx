import type { Metadata } from 'next'
import { Eyebrow } from '@/components/landing/landing-ui'
import { ReleaseTimeline } from '@/components/public/ReleaseTimeline'
import { getReleases } from '@/lib/release-notes'

export const metadata: Metadata = {
  title: 'Release Notes · Pulsify',
  description:
    'Every Pulsify release in one place — features, improvements, fixes and UI/UX polish. Search by keyword or filter by category.',
  alternates: { canonical: '/release-notes' },
}

export default async function ReleaseNotesPage() {
  const releases = await getReleases()
  const latest = releases[0]

  return (
    <div className="mx-auto max-w-6xl px-6 pb-14 pt-10 sm:pb-20 sm:pt-14">
      {/* Hero — matches the Community page chrome so the two pages read as a
          set when linked from the footer. */}
      <header className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <Eyebrow>Release Notes</Eyebrow>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          What we shipped
        </h1>
        <p className="mt-5 text-base leading-relaxed" style={{ color: 'var(--text-2)' }}>
          A complete log of every Pulsify release — features, improvements, fixes and UI polish, with categorised sections you can search or filter.
        </p>
        {latest && (
          <p className="mt-4 inline-flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            <span
              className="rounded-md px-2 py-0.5 font-mono text-xs font-semibold"
              style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
            >
              v{latest.version}
            </span>
            Latest release · {latest.date}
          </p>
        )}
      </header>

      <ReleaseTimeline releases={releases} />
    </div>
  )
}
