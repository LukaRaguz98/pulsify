'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import {
  RISK_META,
  STATUS_META,
  confidenceLabel,
  type AltRiskLevel,
  type InvestigationStatus,
} from '@/lib/alt-detection'

// Shared visual language for Alt Risk Detection (PULSIFY-59).
//
// Risk is a judgement call a human makes, so the UI's job is to convey *how much
// evidence there is* without ever looking like a verdict: bands rather than
// precise-looking numbers, confidence meters rather than checkmarks, and the
// word "potential" wherever a link is shown.

/** Risk band pill — the one badge every risk surface uses. */
export function RiskBadge({
  level,
  score,
  size = 'md',
}: {
  level: AltRiskLevel
  /** Shown alongside the label when given ("High · 62"). */
  score?: number
  size?: 'sm' | 'md'
}) {
  const meta = RISK_META[level]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold ${
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
      }`}
      style={{ background: meta.tint, color: meta.color }}
      title={meta.blurb}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
      {score != null && <span style={{ opacity: 0.75 }}>· {score}</span>}
    </span>
  )
}

/**
 * The score itself, as a ring. 0-100 with the band's colour — big enough to be
 * the anchor of the account report, but deliberately labelled "Alt risk score"
 * rather than anything that reads like a probability of guilt.
 */
export function ScoreRing({ score, level, size = 112 }: { score: number; level: AltRiskLevel; size?: number }) {
  const meta = RISK_META[level]
  const thickness = size >= 100 ? 10 : 7
  return (
    <div
      className="relative flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${meta.color} ${score * 3.6}deg, var(--bg-2) ${score * 3.6}deg)`,
      }}
      role="img"
      aria-label={`Alt risk score ${score} out of 100 — ${meta.label}`}
    >
      <div
        className="flex flex-col items-center justify-center rounded-full"
        style={{
          width: size - thickness * 2,
          height: size - thickness * 2,
          background: 'var(--panel)',
        }}
      >
        <span className="text-2xl font-bold leading-none" style={{ color: meta.color }}>
          {score}
        </span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
          {meta.label}
        </span>
      </div>
    </div>
  )
}

/** Confidence meter for a potential link — a percentage, never a checkmark. */
export function ConfidenceMeter({ confidence, manual }: { confidence: number; manual?: boolean }) {
  const { label, color } = manual
    ? { label: 'Confirmed by a moderator', color: 'var(--p-1)' }
    : confidenceLabel(confidence)
  return (
    <div className="w-full min-w-[92px] max-w-[160px]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
          {label}
        </span>
        <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>
          {confidence}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.max(4, confidence)}%`, background: color }}
        />
      </div>
    </div>
  )
}

/** Investigation status pill. */
export function StatusPill({ status, size = 'md' }: { status: InvestigationStatus; size?: 'sm' | 'md' }) {
  const meta = STATUS_META[status]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold ${
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
      }`}
      style={{ background: `${meta.color}1f`, color: meta.color }}
      title={meta.description}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

/** Small member avatar with a name — repeated in every list on this page. */
export function AccountChip({
  avatar,
  name,
  subtitle,
  size = 36,
}: {
  avatar: string
  name: string
  subtitle?: string
  size?: number
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Image
        src={avatar}
        alt=""
        width={size}
        height={size}
        unoptimized
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        {subtitle && <p className="truncate text-xs text-subtle">{subtitle}</p>}
      </div>
    </div>
  )
}

/** Neutral counter tile — the "at a glance" row shared with the other modules. */
export function StatTile({
  icon,
  label,
  value,
  accent,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  accent: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div
        className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ background: `${accent}1f`, color: accent }}
      >
        {icon}
      </div>
      <p className="text-2xl font-semibold text-foreground">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      <p className="text-xs text-subtle">{label}</p>
      {hint && <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>{hint}</p>}
    </div>
  )
}

function relativeLabel(iso: string, now: number): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

/**
 * Relative time ("3 days ago"), with the absolute date on hover. `now` is held in
 * state (seeded lazily, ticked once a minute) rather than read during render, so
 * the component stays pure and a page left open doesn't go stale.
 */
export function TimeAgo({ iso, prefix }: { iso: string | null; prefix?: string }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  if (!iso) return <span className="text-subtle">—</span>
  return (
    <span title={new Date(iso).toLocaleString()}>
      {prefix ? `${prefix} ` : ''}
      {relativeLabel(iso, now)}
    </span>
  )
}
