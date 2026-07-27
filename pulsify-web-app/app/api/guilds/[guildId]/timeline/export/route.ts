import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import { fetchGuild } from '@/lib/discord'
import {
  parseTimelineFilters,
  retentionWindow,
  effectiveSince,
  fetchTimelineForExport,
  EXPORT_ROW_CAP,
} from '@/lib/timeline-query'
import { renderPdf, type PdfBlock } from '@/lib/pdf'
import {
  toCsv,
  toJson,
  eventLabel,
  formatActor,
  moduleLabel,
  exportFilename,
  diffValues,
  formatFieldName,
  formatValue,
  groupByDay,
  dayHeading,
  CATEGORY_LABELS,
  SOURCE_LABELS,
  EXPORT_FORMATS,
  type ExportFormat,
  type TimelineEvent,
} from '@/lib/timeline'

/**
 * GET /api/guilds/[guildId]/timeline/export
 *
 * Exports the timeline as CSV, JSON or PDF.
 *
 * Three scopes, expressed through the same query parameters the feed uses:
 *   • selected events — `ids=a,b,c` (wins over every filter)
 *   • filtered timeline — any of `category` / `actor` / `member` / `module` /
 *     `type` / `from` / `to` / `q`
 *   • complete history — no filters at all
 *
 * Everything is bounded by the guild plan's `logRetentionDays`, so an export
 * can never contain more history than the dashboard itself will show.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params

  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const formatParam = url.searchParams.get('format') ?? 'csv'
  if (!(EXPORT_FORMATS as readonly string[]).includes(formatParam)) {
    return NextResponse.json(
      { error: `Unsupported format. Use one of: ${EXPORT_FORMATS.join(', ')}.` },
      { status: 400 },
    )
  }
  const format = formatParam as ExportFormat

  const filters = parseTimelineFilters(url)
  const ids = (url.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))

  const { retentionDays, since } = await retentionWindow(guildId)
  const supabase = await createClient()

  const result = await fetchTimelineForExport(supabase, guildId, filters, {
    since: effectiveSince(since, filters.from),
    ids,
  })
  if ('error' in result) {
    return NextResponse.json({ error: `Export failed: ${result.error}` }, { status: 500 })
  }

  const guild = await fetchGuild(guildId)
  const guildName = guild?.name ?? 'Server'
  const filename = exportFilename(guildName, format)
  const { events, truncated } = result

  const scope = ids.length > 0
    ? `${events.length} selected event${events.length === 1 ? '' : 's'}`
    : describeFilters(filters)

  if (format === 'json') {
    return download(
      toJson(events, {
        guildId,
        guildName,
        scope,
        retentionDays: Number.isFinite(retentionDays) ? retentionDays : null,
        truncated,
      }),
      'application/json; charset=utf-8',
      filename,
    )
  }

  if (format === 'csv') {
    // A BOM so Excel opens the file as UTF-8 instead of guessing a codepage —
    // without it, every em dash and accented name comes out mangled.
    return download(`﻿${toCsv(events)}`, 'text/csv; charset=utf-8', filename)
  }

  return download(
    renderPdf(buildPdfDocument({ guildName, scope, events, truncated })),
    'application/pdf',
    filename,
  )
}

function download(body: string | Buffer, contentType: string, filename: string): Response {
  return new Response(body as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      // An export is a snapshot of a moving feed; never let it be cached.
      'Cache-Control': 'no-store',
    },
  })
}

/** Human summary of the active filters, printed on the export itself. */
function describeFilters(filters: ReturnType<typeof parseTimelineFilters>): string {
  const parts: string[] = []
  if (filters.category) parts.push(`category: ${CATEGORY_LABELS[filters.category as keyof typeof CATEGORY_LABELS] ?? filters.category}`)
  if (filters.module) parts.push(`module: ${moduleLabel(filters.module)}`)
  if (filters.eventType) parts.push(`event: ${eventLabel(filters.eventType)}`)
  if (filters.actorId) parts.push(`administrator: ${filters.actorId}`)
  if (filters.memberId) parts.push(`member: ${filters.memberId}`)
  if (filters.from) parts.push(`from ${filters.from.slice(0, 10)}`)
  if (filters.to) parts.push(`to ${filters.to.slice(0, 10)}`)
  if (filters.query) parts.push(`search: "${filters.query}"`)
  return parts.length > 0 ? `Filtered — ${parts.join(', ')}` : 'Complete history'
}

/**
 * Compose the PDF report.
 *
 * The PDF is the "hand this to someone" format, so it reads as a document
 * rather than a table dump: events are grouped under day headings exactly as
 * the dashboard groups them, and each entry carries its actor, target and — the
 * reason anyone exports a timeline in the first place — what changed.
 */
function buildPdfDocument(opts: {
  guildName: string
  scope: string
  events: TimelineEvent[]
  truncated: boolean
}): Parameters<typeof renderPdf>[0] {
  const blocks: PdfBlock[] = []

  blocks.push({
    kind: 'text',
    text: `${opts.events.length} event${opts.events.length === 1 ? '' : 's'} — ${opts.scope}`,
    muted: true,
    size: 9,
  })

  if (opts.truncated) {
    blocks.push({
      kind: 'text',
      text: `Note: this export was capped at ${EXPORT_ROW_CAP.toLocaleString()} events. Narrow the date range or filters to export the rest.`,
      muted: true,
      size: 9,
    })
  }

  if (opts.events.length === 0) {
    blocks.push({ kind: 'space', height: 12 })
    blocks.push({ kind: 'text', text: 'No events matched this selection.', muted: true })
    return { title: `${opts.guildName} — Server History`, subtitle: subtitle(), footer: footer(opts.guildName), blocks }
  }

  for (const group of groupByDay(opts.events)) {
    blocks.push({ kind: 'heading', text: dayHeading(group.key) })
    blocks.push({ kind: 'rule' })

    for (const event of group.events) {
      const time = new Date(event.createdAt).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })
      blocks.push({
        kind: 'text',
        text: `${time}  ·  ${CATEGORY_LABELS[event.category]}  ·  ${eventLabel(event.eventType)}`,
        muted: true,
        size: 7.5,
      })
      blocks.push({ kind: 'text', text: event.title, bold: true, size: 10 })

      if (event.description) {
        blocks.push({ kind: 'text', text: event.description, size: 9, muted: true })
      }

      const meta: string[] = [`By ${formatActor(event.actor)}`, `via ${SOURCE_LABELS[event.source]}`]
      if (event.targetName) meta.push(`Affected: ${event.targetName}`)
      if (event.module) meta.push(`Module: ${moduleLabel(event.module)}`)
      blocks.push({ kind: 'text', text: meta.join('  ·  '), size: 8, muted: true })

      for (const diff of diffValues(event.previousValue, event.newValue)) {
        blocks.push({
          kind: 'text',
          text: `${formatFieldName(diff.field)}: ${formatValue(diff.previous)} → ${formatValue(diff.next)}`,
          size: 8.5,
          indent: 12,
        })
      }

      if (event.affectedUsers.length > 0) {
        blocks.push({
          kind: 'text',
          text: `Affected members: ${event.affectedUsers.map((u) => u.name ?? u.id).join(', ')}`,
          size: 8.5,
          indent: 12,
          muted: true,
        })
      }

      blocks.push({ kind: 'space', height: 8 })
    }
  }

  return {
    title: `${opts.guildName} — Server History`,
    subtitle: subtitle(),
    footer: footer(opts.guildName),
    blocks,
  }
}

function subtitle(): string {
  return `Exported ${new Date().toLocaleString()} · Generated by Pulsify`
}

function footer(guildName: string): string {
  return `${guildName} — Server History`
}
