'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Timeframe } from '@/lib/analytics'
import type { ManagementData } from '@/lib/management'

/**
 * Loads the management analytics payload for a guild + timeframe. Mirrors
 * useInsights/useAnalytics: a blocking initial load, a silent refresh that keeps
 * the old data on screen, and a surfaced error string.
 */
export function useManagement(guildId: string, timeframe: Timeframe) {
  const [data, setData] = useState<ManagementData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/guilds/${guildId}/management?timeframe=${timeframe}`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Request failed (${res.status})`)
        }
        setData((await res.json()) as ManagementData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load management analytics.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [guildId, timeframe],
  )

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, refreshing, error, refresh: () => load(true) }
}
