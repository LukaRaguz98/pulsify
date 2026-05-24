import type { NotificationCategory, NotificationSeverity } from '@/lib/notifications'

/**
 * Visual mapping shared by the bell dropdown, the activity feed, the toasts,
 * and the detail modal so a given notification looks the same everywhere.
 */
export const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  info:    '#3b82f6',
  success: '#10b981',
  warning: '#f59e0b',
  error:   '#ef4444',
}

export const SEVERITY_BG: Record<NotificationSeverity, string> = {
  info:    'rgba(59,130,246,0.12)',
  success: 'rgba(16,185,129,0.12)',
  warning: 'rgba(245,158,11,0.12)',
  error:   'rgba(239,68,68,0.12)',
}

export const CATEGORY_ACCENT: Record<NotificationCategory, string> = {
  members:     '#10b981',
  moderation:  '#f87171',
  roles:       '#a78bfa',
  events:      '#22d3ee',
  channels:    '#3b82f6',
  settings:    '#94a3b8',
  automations: '#f59e0b',
  tickets:     '#5865f2',
  bot:         '#ec4899',
}

/** Compact relative-time label suitable for the dropdown rows. */
export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
