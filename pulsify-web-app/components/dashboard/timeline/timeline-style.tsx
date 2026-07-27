'use client'

import {
  Users, Hash, UserRound, Shield, Coins, Zap, CalendarDays, SlidersHorizontal,
  MonitorSmartphone, MessageSquare, TerminalSquare, Bot, Server, Ban, UserMinus,
  UserPlus, Clock, Pencil, Trash2, Plus, ShieldAlert, Gift, Vote, Megaphone,
  Plug, DatabaseBackup, LayoutTemplate, ShoppingBag, Award, Cake, LifeBuoy,
  Siren, Fingerprint, KeyRound,
} from 'lucide-react'
import {
  CATEGORY_ACCENT,
  SEVERITY_COLOR,
  type TimelineCategory,
  type TimelineEvent,
  type TimelineSeverity,
  type TimelineSource,
} from '@/lib/timeline'

/**
 * Shared visual language for the Server Timeline (PULSIFY-63).
 *
 * A timeline lives or dies on scannability: an admin scrolling a month of
 * history should be able to spot "the day someone deleted a channel" without
 * reading a word. So colour carries the CATEGORY (stable, learnable) and the
 * glyph carries the EVENT (what actually happened), with severity relegated to
 * a small dot — otherwise every card competes to look urgent.
 */

/** Category glyph — the icon on the timeline rail. */
export const CATEGORY_ICON: Record<TimelineCategory, React.ReactNode> = {
  roles: <Users size={14} />,
  channels: <Hash size={14} />,
  members: <UserRound size={14} />,
  moderation: <Shield size={14} />,
  economy: <Coins size={14} />,
  automation: <Zap size={14} />,
  events: <CalendarDays size={14} />,
  configuration: <SlidersHorizontal size={14} />,
}

/**
 * Per-event glyph, falling back to the category icon. Only events whose shape
 * differs meaningfully from their category get their own — a deletion should
 * never look like a creation.
 */
const EVENT_ICON: Record<string, React.ReactNode> = {
  role_created: <Plus size={14} />,
  role_deleted: <Trash2 size={14} />,
  role_renamed: <Pencil size={14} />,
  role_permissions_changed: <KeyRound size={14} />,
  channel_created: <Plus size={14} />,
  channel_deleted: <Trash2 size={14} />,
  channel_renamed: <Pencil size={14} />,
  channel_permissions_changed: <KeyRound size={14} />,
  member_joined: <UserPlus size={14} />,
  member_left: <UserMinus size={14} />,
  member_banned: <Ban size={14} />,
  member_kicked: <UserMinus size={14} />,
  member_timeout: <Clock size={14} />,
  member_timeout_removed: <Clock size={14} />,
  member_nickname_changed: <Pencil size={14} />,
  member_milestone_reached: <Award size={14} />,
  member_birthday: <Cake size={14} />,
  moderation_warning: <ShieldAlert size={14} />,
  guard_detection: <ShieldAlert size={14} />,
  guard_scam: <ShieldAlert size={14} />,
  guard_toxic: <MessageSquare size={14} />,
  alt_risk_flagged: <Fingerprint size={14} />,
  security_alert: <Siren size={14} />,
  security_mitigation: <Siren size={14} />,
  security_recovered: <Siren size={14} />,
  ticket_opened: <LifeBuoy size={14} />,
  ticket_closed: <LifeBuoy size={14} />,
  economy_purchase: <ShoppingBag size={14} />,
  giveaway_started: <Gift size={14} />,
  giveaway_ended: <Gift size={14} />,
  giveaway_rerolled: <Gift size={14} />,
  poll_published: <Vote size={14} />,
  poll_closed: <Vote size={14} />,
  announcement_published: <Megaphone size={14} />,
  announcement_failed: <Megaphone size={14} />,
  integration_connected: <Plug size={14} />,
  integration_disconnected: <Plug size={14} />,
  integration_error: <Plug size={14} />,
  backup_created: <DatabaseBackup size={14} />,
  backup_restored: <DatabaseBackup size={14} />,
  backup_deleted: <DatabaseBackup size={14} />,
  template_imported: <LayoutTemplate size={14} />,
  template_saved: <LayoutTemplate size={14} />,
  verification_updated: <Shield size={14} />,
  bot_error: <Bot size={14} />,
}

export function eventIcon(event: TimelineEvent): React.ReactNode {
  return EVENT_ICON[event.eventType] ?? CATEGORY_ICON[event.category]
}

/** Where the change came from — the badge that beats Discord's audit log. */
export const SOURCE_ICON: Record<TimelineSource, React.ReactNode> = {
  dashboard: <MonitorSmartphone size={11} />,
  discord: <MessageSquare size={11} />,
  command: <TerminalSquare size={11} />,
  bot: <Bot size={11} />,
  system: <Server size={11} />,
}

/**
 * The circular marker on the timeline rail: category-tinted, with a severity
 * ring only when the event is worse than routine — so warnings and critical
 * events pop out of a scroll without every row shouting.
 */
export function TimelineMarker({
  category,
  severity,
  children,
}: {
  category: TimelineCategory
  severity: TimelineSeverity
  children: React.ReactNode
}) {
  const accent = CATEGORY_ACCENT[category]
  const alarming = severity === 'warning' || severity === 'critical'
  return (
    <span
      className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
      style={{
        background: `color-mix(in srgb, ${accent} 16%, var(--panel))`,
        color: accent,
        border: `1px solid color-mix(in srgb, ${accent} 40%, transparent)`,
        boxShadow: alarming ? `0 0 0 3px color-mix(in srgb, ${SEVERITY_COLOR[severity]} 18%, transparent)` : undefined,
      }}
    >
      {children}
    </span>
  )
}

/** Small category chip used on cards and in the detail drawer. */
export function CategoryChip({ category, label }: { category: TimelineCategory; label: string }) {
  const accent = CATEGORY_ACCENT[category]
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide"
      style={{
        background: 'var(--bg-2)',
        color: accent,
        border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
      }}
    >
      {label}
    </span>
  )
}
