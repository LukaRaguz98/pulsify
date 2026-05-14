'use client'

import { useState, useEffect, useCallback } from 'react'
import type { AnalyticsData, Timeframe } from '@/lib/analytics'

export function useAnalytics(guildId: string, timeframe: Timeframe) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/discord/guild/${guildId}/analytics?timeframe=${timeframe}`,
          { cache: 'no-store' }
        )
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Request failed (${res.status})`)
        }
        setData((await res.json()) as AnalyticsData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load analytics.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [guildId, timeframe]
  )

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, refreshing, error, refresh: () => load(true) }
}
