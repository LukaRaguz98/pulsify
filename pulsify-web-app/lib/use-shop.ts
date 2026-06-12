'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ShopReward, RewardPurchase, RequirementContext } from '@/lib/shop'

// Client data hooks for the Rewards Shop (PULSIFY-46). Mirror useEconomy:
// a blocking initial load, a silent refresh, and a surfaced error string.

export type ShopData = {
  rewards: ShopReward[]
  context: RequirementContext
  ownedCounts: Record<string, number>
  isAdmin: boolean
  isOperator: boolean
}

const EMPTY_CONTEXT: RequirementContext = { reputation: 0, level: 0, balance: 0, achievementIds: [] }

export function useShop(guildId: string, { manage = false }: { manage?: boolean } = {}) {
  const [data, setData] = useState<ShopData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/guilds/${guildId}/economy/shop${manage ? '?manage=1' : ''}`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Request failed (${res.status})`)
        }
        const json = (await res.json()) as Partial<ShopData>
        setData({
          rewards: json.rewards ?? [],
          context: json.context ?? EMPTY_CONTEXT,
          ownedCounts: json.ownedCounts ?? {},
          isAdmin: json.isAdmin ?? false,
          isOperator: json.isOperator ?? false,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load the shop.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [guildId, manage],
  )

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, refreshing, error, refresh: () => load(true) }
}

export function useInventory(guildId: string) {
  const [purchases, setPurchases] = useState<RewardPurchase[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/guilds/${guildId}/economy/inventory`, { cache: 'no-store' })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Request failed (${res.status})`)
        }
        const json = (await res.json()) as { purchases?: RewardPurchase[] }
        setPurchases(json.purchases ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load your inventory.')
      } finally {
        setLoading(false)
      }
    },
    [guildId],
  )

  useEffect(() => {
    load()
  }, [load])

  return { purchases, loading, error, refresh: () => load(true) }
}
