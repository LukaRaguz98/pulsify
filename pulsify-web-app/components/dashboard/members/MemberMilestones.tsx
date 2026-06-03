'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Award, Check, Lock, ChevronLeft, ChevronRight } from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { createClient as createSupabase } from '@/lib/supabase'
import {
  normaliseMilestone,
  metricValue,
  milestoneProgress,
  describeThresholdLong,
  formatMetricValueLong,
  type Milestone,
  type MemberMetrics,
} from '@/lib/milestones'
import { MilestoneIcon } from '@/components/dashboard/milestones/icons'

type BaseMetrics = {
  join_age_days: number
  messages: number
  voice_minutes: number
  xp: number
  level: number
}

type CompletionRow = { milestone_id: string; value: number; completed_at: string }

/**
 * Steam-style achievements for a member: every milestone the server has defined,
 * shown as unlocked (earned) or locked with live progress toward the threshold.
 * Mirrors the bot's /profile "Milestones" page. Reads the milestone tables
 * directly with the browser Supabase client (RLS allow-all, same as the member
 * directory's realtime). `base` carries the metric values already computed by
 * the profile (messages/voice/xp/level/tenure); giveaway + event counts (the two
 * the profile doesn't fetch) are loaded here and merged.
 */
export function MemberMilestones({
  guildId,
  userId,
  base,
}: {
  guildId: string
  userId: string
  base: BaseMetrics
}) {
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [completions, setCompletions] = useState<CompletionRow[]>([])
  const [counts, setCounts] = useState<{ giveaways: number; events: number }>({ giveaways: 0, events: 0 })
  const [loaded, setLoaded] = useState(false)
  const [page, setPage] = useState(0)

  const load = useCallback(async () => {
    const supabase = createSupabase()
    const [defs, comp, gw, evt] = await Promise.all([
      supabase.from('milestones').select('*').eq('guild_id', guildId).eq('enabled', true),
      supabase.from('member_milestones').select('milestone_id, value, completed_at').eq('guild_id', guildId).eq('user_id', userId),
      supabase.from('giveaway_entries').select('user_id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('user_id', userId),
      supabase.from('member_event_participation').select('user_id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('user_id', userId),
    ])
    setMilestones((defs.data ?? []).map((r) => normaliseMilestone(r as Record<string, unknown>)))
    setCompletions((comp.data ?? []) as CompletionRow[])
    setCounts({ giveaways: gw.count ?? 0, events: evt.count ?? 0 })
    setLoaded(true)
  }, [guildId, userId])

  useEffect(() => {
    void load()
  }, [load])

  // Refresh when this member earns a milestone so unlocked state updates live.
  useEffect(() => {
    const supabase = createSupabase()
    const channel = supabase
      .channel(`member-milestones:${guildId}:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_milestones', filter: `user_id=eq.${userId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'milestones', filter: `guild_id=eq.${guildId}` }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [guildId, userId, load])

  const metrics: MemberMetrics = useMemo(
    () => ({
      join_age_days: base.join_age_days,
      messages: base.messages,
      voice_minutes: base.voice_minutes,
      events: counts.events,
      giveaways: counts.giveaways,
      xp: base.xp,
      level: base.level,
    }),
    [base, counts],
  )

  const earnedById = useMemo(() => {
    const m = new Map<string, CompletionRow>()
    for (const c of completions) m.set(c.milestone_id, c)
    return m
  }, [completions])

  const items = useMemo(() => {
    return milestones
      .map((m) => {
        const completion = earnedById.get(m.id) ?? null
        const value = metricValue(metrics, m.metric)
        const prog = milestoneProgress(value, m.threshold)
        return { milestone: m, completion, prog, value, earned: !!completion }
      })
      // Unlocked first, then by closeness to completion.
      .sort((a, b) => {
        if (a.earned !== b.earned) return a.earned ? -1 : 1
        return b.prog.pct - a.prog.pct
      })
  }, [milestones, earnedById, metrics])

  // Render nothing until loaded, and skip entirely for servers with no
  // milestones (so member profiles aren't cluttered with an empty section).
  if (!loaded || milestones.length === 0) return null

  const earnedCount = items.filter((i) => i.earned).length

  // Page through the milestones 9 at a time (a 3×3 board) so a member with many
  // achievements stays scannable; the page is clamped in case the list shrinks.
  const PER_PAGE = 9
  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE))
  const safePage = Math.min(Math.max(0, page), totalPages - 1)
  const pageItems = items.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE)

  return (
    <CategorySection
      icon={<Award size={14} />}
      title="Milestones"
      description={`Milestones earned in this server — ${earnedCount} of ${milestones.length} unlocked.`}
      action={
        totalPages > 1 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums" style={{ color: 'var(--text-3)' }}>
              Page {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(safePage - 1)}
              disabled={safePage <= 0}
              aria-label="Previous milestones"
              className="flex h-7 w-7 items-center justify-center rounded-lg border transition-colors disabled:opacity-40"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => setPage(safePage + 1)}
              disabled={safePage >= totalPages - 1}
              aria-label="Next milestones"
              className="flex h-7 w-7 items-center justify-center rounded-lg border transition-colors disabled:opacity-40"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pageItems.map(({ milestone, completion, prog, value, earned }) => (
          <div
            key={milestone.id}
            className="flex flex-col rounded-2xl border p-4 transition-colors"
            style={{
              background: 'var(--panel)',
              borderColor: earned ? 'var(--p-1)' : 'var(--line-strong)',
              opacity: earned ? 1 : 0.92,
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: earned ? 'var(--p-soft)' : 'var(--bg-2)',
                  color: earned ? 'var(--p-1)' : 'var(--text-3)',
                  filter: earned ? 'none' : 'grayscale(1)',
                }}
              >
                <MilestoneIcon name={milestone.icon} size={20} />
                <span
                  className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2"
                  style={{
                    borderColor: 'var(--panel)',
                    background: earned ? '#22c55e' : 'var(--bg-2)',
                    color: earned ? '#fff' : 'var(--text-3)',
                  }}
                >
                  {earned ? <Check size={11} /> : <Lock size={10} />}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">{milestone.name}</p>
                <p className="truncate text-xs" style={{ color: 'var(--text-3)' }}>
                  {describeThresholdLong(milestone.metric, milestone.threshold)}
                </p>
              </div>
            </div>

            {milestone.description && (
              <p className="mt-2.5 line-clamp-2 text-xs" style={{ color: 'var(--text-2)' }}>
                {milestone.description}
              </p>
            )}

            <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--line-strong)' }}>
              {earned ? (
                <p className="flex items-center gap-1.5 text-xs font-medium" style={{ color: '#22c55e' }}>
                  <Check size={13} />
                  Unlocked
                  {completion?.completed_at ? ` · ${new Date(completion.completed_at).toLocaleDateString()}` : ''}
                </p>
              ) : (
                <>
                  <div className="mb-1.5 flex items-center justify-between text-[11px]" style={{ color: 'var(--text-3)' }}>
                    <span>
                      {formatMetricValueLong(milestone.metric, value)} / {formatMetricValueLong(milestone.metric, milestone.threshold)}
                    </span>
                    <span>{prog.pct >= 100 ? 'Unlocking…' : `${prog.pct}%`}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(3, prog.pct)}%`, background: 'linear-gradient(90deg, var(--p-1), var(--p-2))' }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </CategorySection>
  )
}
