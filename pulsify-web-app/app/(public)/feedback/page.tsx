import type { Metadata } from 'next'
import { Eyebrow } from '@/components/landing/landing-ui'
import { listFeedback, getOwnFeedback } from '@/lib/feedback-server'
import { FeedbackExplorer } from '@/components/feedback/FeedbackExplorer'

export const metadata: Metadata = {
  title: 'Community Feedback · Pulsify',
  description:
    'Read what real Discord community builders think of Pulsify — browse, search and sort community reviews, and share your own feedback.',
  alternates: { canonical: '/feedback' },
}

// Always render fresh so newly-submitted feedback and votes show immediately.
export const dynamic = 'force-dynamic'

export default async function FeedbackPage() {
  // Default landing view = top-rated. The explorer refetches client-side as the
  // viewer changes sort / search / rating.
  const { items, viewer } = await listFeedback({ sort: 'top' })
  const own = await getOwnFeedback(viewer)

  return (
    <div className="mx-auto max-w-6xl px-6 pb-14 pt-10 sm:pb-20 sm:pt-14">
      <header className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <Eyebrow>Feedback</Eyebrow>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          What the community thinks
        </h1>
        <p className="mt-5 text-base leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Real feedback from the people who run their Discord servers on Pulsify. Read their
          reviews, mark the ones that helped you, and share your own experience.
        </p>
      </header>

      <div className="mt-12">
        <FeedbackExplorer
          initialItems={items}
          initialOwn={own}
          viewer={{ userId: viewer.userId, isOperator: viewer.isOperator }}
        />
      </div>
    </div>
  )
}
