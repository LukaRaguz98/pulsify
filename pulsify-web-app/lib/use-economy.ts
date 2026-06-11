'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Timeframe } from '@/lib/analytics'
import type { EconomyAnalytics, EconomyUser } from '@/lib/economy'

export type ServerEconomyRow = {
  user_id: string
  user_name: string | null
  xp: number
  level: number
  balance: number
}

export type EconomyData = {
  timeframe: Timeframe
  totals: { circulation: number; userCount: number }
  analytics: EconomyAnalytics
  leaderboards: {
    richest: EconomyUser[]
    active: EconomyUser[]
    server: ServerEconomyRow[]
  }
}

/**
 * Loads the global economy payload for the Economy view. Mirrors
 * useManagement/useInsights: a blocking initial load, a silent refresh that
 * keeps the old data on screen, and a surfaced error string.
 */
export function useEconomy(guildId: string, timeframe: Timeframe) {
  const [data, setData] = useState<EconomyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/guilds/${guildId}/economy?timeframe=${timeframe}`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Request failed (${res.status})`)
        }
        setData((await res.json()) as EconomyData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load the economy.')
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
