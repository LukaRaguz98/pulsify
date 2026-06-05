// Shared analytics types, timeframe helpers and formatters used by the
// Overview and Statistics dashboards and the /analytics API route.

export type Timeframe = '24h' | '7d' | '30d' | 'all'

export const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All time' },
]

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

// ISO string for the start of the window, or null for "all time".
export function timeframeSince(tf: Timeframe): string | null {
  const now = Date.now()
  switch (tf) {
    case '24h':
      return new Date(now - DAY_MS).toISOString()
    case '7d':
      return new Date(now - 7 * DAY_MS).toISOString()
    case '30d':
      return new Date(now - 30 * DAY_MS).toISOString()
    case 'all':
      return null
  }
}

// Bucket granularity for the timeseries — hourly for 24h, daily otherwise.
export function timeframeBucket(tf: Timeframe): 'hour' | 'day' {
  return tf === '24h' ? 'hour' : 'day'
}

export function isTimeframe(value: unknown): value is Timeframe {
  return value === '24h' || value === '7d' || value === '30d' || value === 'all'
}

/**
 * Days a timeframe spans, used by the comparison-style views (Insights,
 * Management) to size the "previous window" they trend against. `null` for
 * 'all', which has no comparable previous period.
 */
export function timeframeWindowDays(tf: Timeframe): number | null {
  switch (tf) {
    case '24h':
      return 1
    case '7d':
      return 7
    case '30d':
      return 30
    case 'all':
      return null
  }
}

/** Human "period" phrase for copy — e.g. "the last 7 days" / "all time". */
export function timeframePeriodLabel(tf: Timeframe): string {
  switch (tf) {
    case '24h':
      return 'the last 24 hours'
    case '7d':
      return 'the last 7 days'
    case '30d':
      return 'the last 30 days'
    case 'all':
      return 'all time'
  }
}

export type AnalyticsSummary = {
  total_messages: number
  total_commands: number
  total_mod_actions: number
  member_joins: number
  member_leaves: number
  active_users: number
  voice_seconds: number
}

export type TimeseriesPoint = {
  bucket: string
  messages: number
  joins: number
  leaves: number
  commands: number
  mod_actions: number
  voice_seconds: number
}

export type TopChannel = {
  channel_id: string
  channel_name: string | null
  message_count: number
}

export type TopUser = {
  user_id: string
  user_name: string | null
  message_count: number
}

export type PeakHour = {
  hour: number
  message_count: number
}

export type AnalyticsData = {
  timeframe: Timeframe
  summary: AnalyticsSummary
  timeseries: TimeseriesPoint[]
  topChannels: TopChannel[]
  topUsers: TopUser[]
  peakHours: PeakHour[]
}

export const EMPTY_SUMMARY: AnalyticsSummary = {
  total_messages: 0,
  total_commands: 0,
  total_mod_actions: 0,
  member_joins: 0,
  member_leaves: 0,
  active_users: 0,
  voice_seconds: 0,
}

function emptyPoint(bucket: string): TimeseriesPoint {
  return { bucket, messages: 0, joins: 0, leaves: 0, commands: 0, mod_actions: 0, voice_seconds: 0 }
}

// The RPC only returns buckets that have data. For a clean chart we fill the
// gaps so every hour/day in the window is represented.
export function fillTimeseries(data: TimeseriesPoint[], timeframe: Timeframe): TimeseriesPoint[] {
  if (timeframe === 'all') {
    return [...data].sort((a, b) => a.bucket.localeCompare(b.bucket))
  }

  const stepMs = timeframeBucket(timeframe) === 'hour' ? HOUR_MS : DAY_MS
  const sinceMs = new Date(timeframeSince(timeframe)!).getTime()
  const start = Math.floor(sinceMs / stepMs) * stepMs
  const now = Date.now()

  const byBucket = new Map(
    data.map((d) => [Math.floor(new Date(d.bucket).getTime() / stepMs) * stepMs, d])
  )

  const out: TimeseriesPoint[] = []
  for (let t = start; t <= now; t += stepMs) {
    out.push(byBucket.get(t) ?? emptyPoint(new Date(t).toISOString()))
  }
  return out
}

export function formatBucketLabel(iso: string, timeframe: Timeframe): string {
  const d = new Date(iso)
  if (timeframe === '24h') {
    return d.toLocaleTimeString([], { hour: 'numeric' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// Compact human-readable duration from a second count: "3h 12m", "45m", "30s".
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
}

export function formatHourLabel(hour: number): string {
  if (hour === 0) return '12am'
  if (hour === 12) return '12pm'
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`
}

export function summaryIsEmpty(s: AnalyticsSummary): boolean {
  return (
    s.total_messages === 0 &&
    s.total_commands === 0 &&
    s.total_mod_actions === 0 &&
    s.member_joins === 0 &&
    s.member_leaves === 0 &&
    s.voice_seconds === 0
  )
}
