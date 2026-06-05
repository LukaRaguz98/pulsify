'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Shield,
  LifeBuoy,
  Megaphone,
  Activity,
  Clock,
  CalendarCheck,
} from 'lucide-react'
import { ROLE_META, formatSeconds, type StaffMemberStats } from '@/lib/management'
import { StaffAvatar } from './StaffAvatar'

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function StaffProfileDrawer({
  staff,
  windowDays,
  onClose,
}: {
  staff: StaffMemberStats | null
  windowDays: number
  onClose: () => void
}) {
  useEffect(() => {
    if (!staff) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [staff, onClose])

  if (!staff || typeof document === 'undefined') return null

  const role = ROLE_META[staff.role]

  return createPortal(
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <aside
        className="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <StaffAvatar name={staff.name} avatar={staff.avatar} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-semibold text-foreground">{staff.name}</h2>
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{ background: `color-mix(in srgb, ${role.accent} 16%, transparent)`, color: role.accent }}
              >
                {role.label}
              </span>
              {staff.isInactive && (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: 'color-mix(in srgb, #f59e0b 16%, transparent)', color: '#f59e0b' }}
                >
                  Inactive
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-3)' }}>
              {staff.totalActions.toLocaleString()} actions · last active {timeAgo(staff.lastActiveAt)} · over the last {windowDays} days
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground transition hover:text-foreground" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-5">
          {/* Activity snapshot */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            <MiniStat icon={<Activity size={14} />} label="Total actions" value={staff.totalActions.toLocaleString()} accent="var(--p-1)" />
            <MiniStat icon={<CalendarCheck size={14} />} label="Active days" value={`${staff.activeDays}/${windowDays}`} accent="#10b981" />
            <MiniStat icon={<Clock size={14} />} label="Consistency" value={`${staff.consistencyPct}%`} accent="#22d3ee" />
          </div>

          {/* Moderation */}
          <Section icon={<Shield size={13} />} title="Moderation" accent="#f87171" total={staff.moderationTotal}>
            <Row label="Warnings" value={staff.warnings} />
            <Row label="Timeouts" value={staff.timeouts} />
            <Row label="Kicks" value={staff.kicks} />
            <Row label="Bans" value={staff.bans} />
            <Row label="Unbans" value={staff.unbans} />
            {staff.moderationOther > 0 && <Row label="Other actions" value={staff.moderationOther} />}
          </Section>

          {/* Support */}
          <Section icon={<LifeBuoy size={13} />} title="Support" accent="#22d3ee" total={staff.ticketsHandled}>
            <Row label="Tickets handled" value={staff.ticketsHandled} />
            <Row label="Tickets resolved" value={staff.ticketsResolved} />
            <Row label="Avg first response" value={formatSeconds(staff.avgFirstResponseSeconds)} />
            <Row label="Avg resolution" value={formatSeconds(staff.avgResolutionSeconds)} />
          </Section>

          {/* Community */}
          <Section icon={<Megaphone size={13} />} title="Community management" accent="#a78bfa" total={staff.communityTotal}>
            <Row label="Announcements" value={staff.announcements} />
            <Row label="Giveaways" value={staff.giveaways} />
            <Row label="Events created" value={staff.eventsCreated} />
          </Section>
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function MiniStat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <span className="flex items-center gap-1.5 text-[11px] text-subtle">
        <span style={{ color: accent }}>{icon}</span>
        {label}
      </span>
      <p className="mt-1 text-lg font-bold text-foreground" style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>
        {value}
      </p>
    </div>
  )
}

function Section({
  icon,
  title,
  accent,
  total,
  children,
}: {
  icon: React.ReactNode
  title: string
  accent: string
  total: number
  children: React.ReactNode
}) {
  return (
    <div className="mb-4 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-2)' }}>
          <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}>
            {icon}
          </span>
          {title}
        </span>
        <span className="font-mono text-xs text-subtle">{total} total</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-semibold text-foreground">{value}</span>
    </div>
  )
}
