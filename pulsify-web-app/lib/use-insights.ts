'use client'

import { useState, useEffect, useCallback } from 'react'
import type { InsightsData, InsightWindow } from '@/lib/insights'

/**
 * Loads the server insights payload for a guild + comparison window. Mirrors
 * useAnalytics: a blocking initial load, a silent refresh that keeps the old
 * data on screen, and a surfaced error string.
 */
export function useInsights(guildId: string, windowDays: InsightWindow) {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/guilds/${guildId}/insights?window=${windowDays}`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Request failed (${res.status})`)
        }
        setData((await res.json()) as InsightsData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load insights.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [guildId, windowDays],
  )

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, refreshing, error, refresh: () => load(true) }
}
