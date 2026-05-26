'use client'

import { useEffect, useState } from 'react'

/**
 * Live countdown to (or "ended" since) an ISO instant. Ticks once a second so
 * the dashboard cards mirror the self-updating <t:unix:R> stamps in the Discord
 * giveaway message. Renders just the text — callers wrap/style it.
 */
export function Countdown({
  target,
  endedLabel = 'Ended',
  prefix = '',
}: {
  target: string
  endedLabel?: string
  prefix?: string
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const ms = new Date(target).getTime() - now
  if (ms <= 0) return <>{endedLabel}</>

  return (
    <>
      {prefix}
      {formatRemaining(ms)}
    </>
  )
}

function formatRemaining(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
