'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, Plus, Loader2, MessageSquare, Star, CheckCircle2, ThumbsUp, ChevronDown } from 'lucide-react'
import {
  computeStats,
  FEEDBACK_SORTS,
  type Feedback,
  type FeedbackInput,
  type FeedbackSort,
  type RatingFilter,
} from '@/lib/feedback'
import { useDiscordSignIn } from '@/components/landing/LandingCtas'
import { FeedbackCard } from './FeedbackCard'
import { FeedbackForm } from './FeedbackForm'
import { StarRating } from './StarRating'

type Viewer = { userId: string | null; isOperator: boolean }

/**
 * The full /feedback discovery experience (PULSIFY-39): browse the community
 * wall with search, sort and rating filters; submit / edit / delete your own
 * feedback; upvote helpful entries; report abuse; operators moderate inline.
 *
 * Reads are public; any write nudges signed-out users through Discord OAuth.
 */
export function FeedbackExplorer({
  initialItems,
  initialOwn,
  viewer,
}: {
  initialItems: Feedback[]
  initialOwn: Feedback | null
  viewer: Viewer
}) {
  const signedIn = !!viewer.userId
  const { signIn } = useDiscordSignIn('/feedback')

  const [items, setItems] = useState<Feedback[]>(initialItems)
  // The stat strip (average + total) reflects the WHOLE community, so it reads
  // from this unfiltered snapshot rather than the displayed `items` list — that
  // way changing the rating/search filter never moves the average. Only the
  // viewer's own add/edit/delete (and operator moderation) update it, since
  // those are the only client actions that actually change the global figures.
  const [baseItems, setBaseItems] = useState<Feedback[]>(initialItems)
  const [own, setOwn] = useState<Feedback | null>(initialOwn)
  const [sort, setSort] = useState<FeedbackSort>('top')
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Feedback | null>(null)

  const stats = computeStats(baseItems)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3200)
  }, [])

  // ── Data fetching ──────────────────────────────────────────────────────────
  const reqId = useRef(0)
  const fetchList = useCallback(async (s: FeedbackSort, q: string, rating: RatingFilter) => {
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ sort: s })
      if (q.trim()) params.set('q', q.trim())
      if (rating) params.set('rating', String(rating))
      const res = await fetch(`/api/feedback?${params}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load feedback')
      const data = (await res.json()) as { items: Feedback[]; own: Feedback | null }
      // Drop stale responses if a newer request started meanwhile.
      if (id !== reqId.current) return
      setItems(data.items)
      setOwn(data.own)
    } catch {
      if (id === reqId.current) setError('Could not load feedback. Please try again.')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])

  // Skip the data effects on the initial mount — the page already provided the
  // first page of results. `mounted` is set by the effect declared LAST below,
  // so both refetch effects see `false` on mount and only fire on real changes.
  const mounted = useRef(false)

  // Refetch immediately when sort / rating change.
  useEffect(() => {
    if (!mounted.current) return
    fetchList(sort, search, ratingFilter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, ratingFilter])

  // Debounce search.
  useEffect(() => {
    if (!mounted.current) return
    const t = window.setTimeout(() => fetchList(sort, search, ratingFilter), 300)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  useEffect(() => {
    mounted.current = true
  }, [])

  // ── Mutations ────────────────────────────────────────────────────────────
  const requireAuth = () => {
    if (!signedIn) {
      signIn()
      return false
    }
    return true
  }

  const upsertItem = (next: Feedback) =>
    setItems((prev) => {
      const i = prev.findIndex((f) => f.id === next.id)
      if (i === -1) return [next, ...prev]
      const copy = [...prev]
      copy[i] = next
      return copy
    })

  // Keep the global stats snapshot in step with create/edit and removals. Votes
  // deliberately don't touch it — a vote changes neither the average nor the
  // review count.
  const upsertBase = (next: Feedback) =>
    setBaseItems((prev) => {
      const i = prev.findIndex((f) => f.id === next.id)
      if (i === -1) return [next, ...prev]
      const copy = [...prev]
      copy[i] = next
      return copy
    })
  const removeBase = (id: string) => setBaseItems((prev) => prev.filter((f) => f.id !== id))

  const handleSubmit = async (input: FeedbackInput): Promise<{ ok: boolean; error?: string }> => {
    const isEdit = !!editing
    const url = isEdit ? `/api/feedback/${editing!.id}` : '/api/feedback'
    const res = await fetch(url, {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = (await res.json().catch(() => ({}))) as { feedback?: Feedback; error?: string }
    if (!res.ok || !data.feedback) return { ok: false, error: data.error ?? 'Could not save feedback.' }
    upsertItem(data.feedback)
    upsertBase(data.feedback)
    setOwn(data.feedback)
    setFormOpen(false)
    setEditing(null)
    flash(isEdit ? 'Your feedback was updated.' : 'Thanks! Your feedback is live.')
    return { ok: true }
  }

  const handleVote = async (f: Feedback) => {
    if (!requireAuth()) return
    setBusyId(f.id)
    // Optimistic toggle.
    const optimistic = { ...f, hasVoted: !f.hasVoted, voteCount: f.voteCount + (f.hasVoted ? -1 : 1) }
    upsertItem(optimistic)
    try {
      const res = await fetch(`/api/feedback/${f.id}/vote`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { hasVoted?: boolean; voteCount?: number; error?: string }
      if (!res.ok) {
        upsertItem(f) // revert
        flash(data.error ?? 'Could not record your vote.')
      } else if (typeof data.voteCount === 'number') {
        upsertItem({ ...f, hasVoted: !!data.hasVoted, voteCount: data.voteCount })
      }
    } catch {
      upsertItem(f)
    } finally {
      setBusyId(null)
    }
  }

  const handleReport = async (f: Feedback) => {
    if (!requireAuth()) return
    const reason = window.prompt('Why are you reporting this feedback? (optional)') ?? undefined
    setBusyId(f.id)
    try {
      const res = await fetch(`/api/feedback/${f.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      flash(res.ok ? 'Thanks — our team will review this.' : data.error ?? 'Could not submit your report.')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (f: Feedback) => {
    if (!window.confirm('Delete your feedback? This cannot be undone.')) return
    setBusyId(f.id)
    try {
      const res = await fetch(`/api/feedback/${f.id}`, { method: 'DELETE' })
      if (res.ok) {
        setItems((prev) => prev.filter((x) => x.id !== f.id))
        removeBase(f.id)
        if (own?.id === f.id) setOwn(null)
        flash('Your feedback was deleted.')
      } else {
        flash('Could not delete your feedback.')
      }
    } finally {
      setBusyId(null)
    }
  }

  // Operator-only: feature / unfeature on the landing page (max 3, enforced
  // server-side). Optimistic, and mirrored into baseItems so the count + badges
  // stay correct under the rating filter.
  const FEATURE_LIMIT = 3
  const featuredCount = baseItems.filter((f) => f.featured).length

  const handleFeature = async (f: Feedback, next: boolean) => {
    const optimistic = { ...f, featured: next }
    upsertItem(optimistic)
    upsertBase(optimistic)
    setBusyId(f.id)
    try {
      const res = await fetch(`/api/feedback/${f.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featured: next }),
      })
      const data = (await res.json().catch(() => ({}))) as { feedback?: Feedback; error?: string }
      if (!res.ok || !data.feedback) {
        upsertItem(f) // revert
        upsertBase(f)
        flash(data.error ?? 'Could not update the landing page.')
      } else {
        upsertItem(data.feedback)
        upsertBase(data.feedback)
        flash(next ? 'Added to the landing page.' : 'Removed from the landing page.')
      }
    } catch {
      upsertItem(f)
      upsertBase(f)
    } finally {
      setBusyId(null)
    }
  }

  const handleModerate = async (f: Feedback, status: 'hidden' | 'removed') => {
    setBusyId(f.id)
    try {
      const res = await fetch(`/api/feedback/${f.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        setItems((prev) => prev.filter((x) => x.id !== f.id))
        removeBase(f.id)
        flash('Feedback hidden from the public wall.')
      } else {
        flash('Could not moderate this feedback.')
      }
    } finally {
      setBusyId(null)
    }
  }

  const openCreate = () => {
    if (!requireAuth()) return
    if (own) {
      setEditing(own)
    } else {
      setEditing(null)
    }
    setFormOpen(true)
  }

  const openEdit = (f: Feedback) => {
    setEditing(f)
    setFormOpen(true)
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Stat strip + primary CTA */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex items-stretch gap-5 self-start rounded-2xl border px-5 py-4"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          {/* Average rating */}
          <div className="flex flex-col justify-center">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold leading-none text-foreground">
                {stats.average ? stats.average.toFixed(1) : '—'}
              </span>
              <span className="text-sm font-medium" style={{ color: 'var(--text-3)' }}>/ 5</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <StarRating value={Math.round(stats.average)} size={14} />
              <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                Average rating
              </span>
            </div>
          </div>

          <div className="w-px self-stretch" style={{ background: 'var(--line-strong)' }} />

          {/* Total reviews */}
          <div className="flex flex-col justify-center">
            <span className="text-3xl font-bold leading-none text-foreground">{stats.total}</span>
            <span className="mt-2 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
              {stats.total === 1 ? 'Review' : 'Reviews'}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all"
          style={{
            background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
            boxShadow: '0 6px 20px -6px var(--p-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
          }}
        >
          <Plus size={16} />
          {own ? 'Edit your feedback' : signedIn ? 'Share your feedback' : 'Sign in to share feedback'}
        </button>
      </div>

      {/* Filters */}
      <div className="mt-8 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search feedback…"
            className="w-full rounded-xl border bg-transparent py-2.5 pl-10 pr-3.5 text-sm text-foreground outline-none transition-colors focus:border-[var(--p-1)]"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
          />
        </div>

        {/* Rating filter chips */}
        <div className="flex items-center gap-1.5">
          {([0, 5, 4, 3, 2, 1] as RatingFilter[]).map((r) => {
            const active = ratingFilter === r
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRatingFilter(r)}
                className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                  background: active ? 'var(--p-soft)' : 'transparent',
                  color: active ? 'var(--p-1)' : 'var(--text-2)',
                }}
              >
                {r === 0 ? 'All' : <>{r}<Star size={11} fill="currentColor" /></>}
              </button>
            )
          })}
        </div>

        {/* Sort — native arrow removed (appearance-none) so we can place our own
            chevron with a proper gap from the right edge. */}
        <div className="relative w-full lg:w-auto">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as FeedbackSort)}
            className="w-full appearance-none rounded-xl border bg-transparent py-2.5 pl-3.5 pr-10 text-sm font-medium text-foreground outline-none transition-colors focus:border-[var(--p-1)]"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
          >
            {FEEDBACK_SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <ChevronDown
            size={15}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-3)' }}
          />
        </div>
      </div>

      {/* Operator hint — current landing-showcase selection. */}
      {viewer.isOperator && (
        <p className="mt-4 text-xs" style={{ color: 'var(--text-3)' }}>
          <span className="font-semibold" style={{ color: 'var(--text-2)' }}>Operator:</span>{' '}
          {featuredCount}/{FEATURE_LIMIT} reviews featured on the landing page
          {featuredCount === 0 && ' — the top-rated three are shown automatically until you pick some.'}
        </p>
      )}

      {/* List */}
      <div className="mt-8">
        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border py-20" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
            <Loader2 size={18} className="animate-spin" /> Loading feedback…
          </div>
        ) : error ? (
          <div className="rounded-2xl border py-16 text-center" style={{ borderColor: 'var(--line-strong)' }}>
            <p className="text-sm font-semibold text-foreground">{error}</p>
            <button
              type="button"
              onClick={() => fetchList(sort, search, ratingFilter)}
              className="mt-3 rounded-lg border px-4 py-2 text-sm font-medium"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed py-16 text-center" style={{ borderColor: 'var(--line-strong)' }}>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
              <MessageSquare size={22} />
            </span>
            <p className="mt-4 text-sm font-semibold text-foreground">
              {search || ratingFilter ? 'No feedback matches your filters' : 'No feedback yet'}
            </p>
            <p className="mt-1 max-w-sm text-xs" style={{ color: 'var(--text-3)' }}>
              {search || ratingFilter ? 'Try a different search or rating.' : 'Be the first to share what you think about Pulsify.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((f) => (
              <FeedbackCard
                key={f.id}
                feedback={f}
                signedIn={signedIn}
                isOperator={viewer.isOperator}
                onVote={handleVote}
                onReport={handleReport}
                onEdit={openEdit}
                onDelete={handleDelete}
                onModerate={handleModerate}
                onFeature={handleFeature}
                atFeatureLimit={featuredCount >= FEATURE_LIMIT}
                busy={busyId === f.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Form modal */}
      {formOpen && (
        <FeedbackForm
          editing={editing}
          onClose={() => {
            setFormOpen(false)
            setEditing(null)
          }}
          onSubmit={handleSubmit}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-2xl"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
        >
          {toast.startsWith('Could not') || toast.startsWith('You ')
            ? <ThumbsUp size={16} style={{ color: 'var(--text-3)' }} />
            : <CheckCircle2 size={16} style={{ color: 'var(--green)' }} />}
          {toast}
        </div>
      )}
    </div>
  )
}
