'use client'

import { useEffect, useState } from 'react'

// Client access to the signed-in member's owned cosmetic EFFECTS (e.g.
// ['corner_hud']), fetched from /api/me/cosmetics. A module-level cache means
// the request fires once per SPA session — CornerDecorations mounts on every
// dashboard/workspace layout and Preferences reads it too, so we don't want a
// fetch per navigation. Call refreshOwnedCosmetics() after a purchase to reflect
// a freshly-unlocked cosmetic.

let cache: string[] | null = null
let inflight: Promise<string[]> | null = null

function load(): Promise<string[]> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = fetch('/api/me/cosmetics', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { effects: [] }))
    .then((j) => {
      cache = Array.isArray(j.effects) ? j.effects : []
      return cache
    })
    .catch(() => {
      cache = []
      return cache
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Drop the cache so the next read refetches (call after buying a cosmetic). */
export function refreshOwnedCosmetics() {
  cache = null
}

/** The distinct cosmetic effect keys the signed-in member owns. */
export function useOwnedCosmeticEffects(): { effects: string[]; loading: boolean } {
  const [effects, setEffects] = useState<string[]>(cache ?? [])
  const [loading, setLoading] = useState(cache === null)

  useEffect(() => {
    let cancelled = false
    if (cache !== null) {
      setEffects(cache)
      setLoading(false)
      return
    }
    load().then((e) => {
      if (!cancelled) {
        setEffects(e)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return { effects, loading }
}
