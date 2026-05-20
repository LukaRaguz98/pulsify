import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import {
  analyzeContent,
  chooseAction,
  normaliseSettings,
  type AIModerationSettings,
  type AnalysisVerdict,
  type AutoAction,
  CATEGORY_LABELS,
} from '@/lib/ai-moderation'
import {
  deleteChannelMessage,
  timeoutMemberDiscord,
  postChannelComponents,
  fetchGuild,
  type V2Container,
} from '@/lib/discord'
import type { V2Attachment } from '@/lib/discord'
import { recordNotification } from '@/lib/notifications-server'
import { getTintedPulseIcon, pulseIconFilename } from '@/lib/pulse-icon'
import { sendPulseGuardWarningDM } from '@/lib/pulse-guard-dm'

// ─── Alert styling ────────────────────────────────────────────────────────────
// Restraint > flair. The container's accent stripe uses the guild's
// configured Pulse Guard embed colour (Settings → Pulse → Guard → Discord
// Output); severity stays a text label.

const SEVERITY_LABEL: Record<AnalysisVerdict['severity'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

/** Parse a `#rrggbb` hex string into a Discord-compatible integer. */
function hexToInt(hex: string, fallback = 0x8b5cf6): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return fallback
  const n = parseInt(m[1], 16)
  return Number.isFinite(n) ? n : fallback
}

const ACTION_LABEL: Record<AutoAction, string> = {
  none:    'No action',
  flag:    'Flagged for review',
  delete:  'Message deleted',
  warn:    'Member warned',
  timeout: 'Member timed out',
}

// The bundled Pulse Guard badge is recoloured to the guild's configured
// `embed_color` so the alert chrome and the icon share one accent. The tint
// pass lives in lib/pulse-icon.ts (shared with the warning DM and /sync). The
// alert header references the upload as `attachment://<filename>`.
const PULSE_GUARD_ICON_FILENAME = pulseIconFilename('guard')

/**
 * Bot-facing endpoint.
 *
 * The Pulse bot calls this on every new message in guilds where Pulse Guard
 * is enabled. The web app keeps all the policy in one place — load settings,
 * apply whitelists, run heuristics + LLM, store the event, execute the
 * configured auto-action, and ping the alert channel.
 *
 * Auth: bearer `PULSIFY_BOT_SECRET` (shared with the bot host). This is the
 * only public endpoint that writes ai_moderation_events without a user
 * session, so the secret is the trust boundary.
 *
 * Request body shape:
 * {
 *   guild_id: "…",
 *   channel_id: "…",
 *   channel_name?: "general",
 *   message_id: "…",
 *   author_id: "…",
 *   author_name?: "Display name",
 *   author_username?: "rawhandle",
 *   author_role_ids?: ["roleId", …],   // for whitelist bypass
 *   content: "raw message content",
 *   mention_count?: number             // count of resolved <@…> mentions
 * }
 *
 * Response:
 *   200 { ok: true, skipped?: 'disabled'|'whitelisted'|'ignored_channel',
 *         event_id?: "…", verdict?: {...}, action?: "delete"|… }
 *   401 invalid bot secret
 *   400 missing required fields
 */
export async function POST(req: Request) {
  const secret = process.env.PULSIFY_BOT_SECRET
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'Bot integration is not configured on the server (PULSIFY_BOT_SECRET missing).' },
      { status: 503 },
    )
  }

  const auth = req.headers.get('authorization') ?? ''
  const provided = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (provided !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    guild_id?: string
    channel_id?: string
    channel_name?: string | null
    message_id?: string
    author_id?: string
    author_name?: string | null
    author_username?: string | null
    author_role_ids?: string[]
    content?: string
    mention_count?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const guildId = body.guild_id
  const content = (body.content ?? '').trim()
  if (!guildId || !content) {
    return NextResponse.json({ ok: false, error: 'guild_id and non-empty content are required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: row } = await supabase
    .from('ai_moderation_settings')
    .select('enabled, sensitivity, settings')
    .eq('guild_id', guildId)
    .maybeSingle()

  if (!row) {
    // No settings row → guild has never configured Pulse Guard. Skip silently.
    return NextResponse.json({ ok: true, skipped: 'not_configured' })
  }

  const rawSettings = (row.settings as Partial<AIModerationSettings> | undefined) ?? {}
  const settings = normaliseSettings({
    ...rawSettings,
    enabled: row.enabled ?? rawSettings.enabled,
    sensitivity: (row.sensitivity as AIModerationSettings['sensitivity']) ?? rawSettings.sensitivity,
  })

  if (!settings.enabled) {
    return NextResponse.json({ ok: true, skipped: 'disabled' })
  }

  // Whitelist bypass: user, role, or channel match → return early without
  // hitting the LLM or writing an event row.
  if (body.author_id && settings.whitelisted_user_ids.includes(body.author_id)) {
    return NextResponse.json({ ok: true, skipped: 'whitelisted_user' })
  }
  if (body.channel_id && settings.ignored_channel_ids.includes(body.channel_id)) {
    return NextResponse.json({ ok: true, skipped: 'ignored_channel' })
  }
  if (
    body.author_role_ids?.length &&
    body.author_role_ids.some((r) => settings.whitelisted_role_ids.includes(r))
  ) {
    return NextResponse.json({ ok: true, skipped: 'whitelisted_role' })
  }

  const verdict = await analyzeContent(content.slice(0, 4000), settings, {
    mentionCount: body.mention_count,
  })
  const configuredAction = chooseAction(verdict, settings)

  // For non-violations we still record a "dismissed" event when LLM ran, so
  // analytics has a denominator. Heuristic-only zeros are dropped to avoid
  // flooding the table with quiet chatter.
  if (!verdict.violates && verdict.categories.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'clean' })
  }

  let executedAction: typeof configuredAction = 'none'
  let actionError: string | null = null

  if (verdict.violates && configuredAction !== 'none') {
    const r = await runAction(configuredAction, {
      guildId,
      channelId: body.channel_id ?? null,
      messageId: body.message_id ?? null,
      authorId: body.author_id ?? null,
      authorUsername: body.author_username ?? body.author_name ?? null,
      timeoutMinutes: settings.timeout_minutes,
    })
    if (r.ok) executedAction = configuredAction
    else actionError = r.error
  }

  const { data: inserted, error } = await supabase
    .from('ai_moderation_events')
    .insert({
      guild_id: guildId,
      message_id: body.message_id ?? null,
      channel_id: body.channel_id ?? null,
      channel_name: body.channel_name ?? null,
      author_id: body.author_id ?? null,
      author_name: body.author_name ?? null,
      author_username: body.author_username ?? null,
      content: content.slice(0, 2000),
      categories: verdict.categories,
      top_category: verdict.topCategory,
      confidence: verdict.confidence,
      severity: verdict.severity,
      reasoning: verdict.reasoning,
      status: verdict.violates
        ? (executedAction === 'none' ? 'pending' : 'auto_actioned')
        : 'dismissed',
      action_taken: executedAction,
      action_meta: {
        actor: 'bot',
        executed_at: new Date().toISOString(),
        ...(actionError ? { error: actionError } : {}),
      },
    })
    .select('id')
    .single()

  if (error || !inserted) {
    return NextResponse.json(
      { ok: false, error: `Failed to record event: ${error?.message ?? 'unknown'}` },
      { status: 500 },
    )
  }

  // Discord alert post + dashboard notification — only for actual violations.
  if (verdict.violates) {
    if (settings.alert_channel_id) {
      // Tint the icon to match settings.embed_color so the alert chrome
      // and the icon share one accent. Cached per colour after first call.
      const iconBuffer = await getTintedPulseIcon('guard', settings.embed_color)
      const attachments: V2Attachment[] = iconBuffer
        ? [{ filename: PULSE_GUARD_ICON_FILENAME, data: iconBuffer, contentType: 'image/png' }]
        : []
      void postChannelComponents(
        settings.alert_channel_id,
        [
          buildAlertContainer({
            verdict,
            executedAction,
            channelId: body.channel_id ?? null,
            channelName: body.channel_name ?? null,
            authorId: body.author_id ?? null,
            authorName: body.author_name ?? null,
            authorUsername: body.author_username ?? null,
            messageContent: content,
            hasIcon: iconBuffer !== null,
            accentColor: hexToInt(settings.embed_color),
          }),
        ],
        attachments,
      )
    }

    if (settings.realtime_alerts) {
      await recordNotification({
        guildId,
        type: 'automation_triggered',
        severity: verdict.severity === 'high' ? 'error' : verdict.severity === 'medium' ? 'warning' : 'info',
        title: `Pulse Guard flagged ${verdict.topCategory ? CATEGORY_LABELS[verdict.topCategory] : 'content'} in ${body.channel_name ? `#${body.channel_name}` : 'a channel'}`,
        body: verdict.reasoning.slice(0, 240),
        link: `/dashboard/${guildId}/ai-moderation`,
        actorId: body.author_id ?? null,
        actorName: body.author_name ?? null,
        actorUsername: body.author_username ?? null,
        targetId: body.message_id ?? null,
        targetName: body.channel_name ?? null,
        metadata: {
          event_id: inserted.id,
          confidence: verdict.confidence,
          top_category: verdict.topCategory,
          action: executedAction,
        },
      })
    }

    // Courtesy DM to the warned member — DM only. The moderator-facing
    // "… detected" alert (posted above to the alert channel) is what mods see;
    // this user-facing "you've received a warning" embed goes to the member's
    // DM exclusively. Best-effort: a member with bot DMs disabled just won't
    // get it.
    if (executedAction === 'warn' && body.author_id) {
      const guild = await fetchGuild(guildId)
      void sendPulseGuardWarningDM({
        userId: body.author_id,
        guildName: guild?.name ?? 'the server',
        reason: verdict.aiReasoning ?? verdict.reasoning,
        categoryLabel: verdict.topCategory ? CATEGORY_LABELS[verdict.topCategory] : null,
        severityLabel: SEVERITY_LABEL[verdict.severity],
        embedColor: settings.embed_color,
      })
    }
  }

  return NextResponse.json({
    ok: true,
    event_id: inserted.id,
    verdict: {
      top_category: verdict.topCategory,
      confidence: verdict.confidence,
      severity: verdict.severity,
      violates: verdict.violates,
      categories: verdict.categories,
    },
    action: executedAction,
    ...(actionError ? { action_error: actionError } : {}),
  })
}

async function runAction(
  action: 'flag' | 'delete' | 'warn' | 'timeout',
  ctx: {
    guildId: string
    channelId: string | null
    messageId: string | null
    authorId: string | null
    authorUsername: string | null
    timeoutMinutes: number
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (action === 'flag') return { ok: true }

  if (action === 'delete') {
    if (!ctx.channelId || !ctx.messageId) return { ok: false, error: 'No message context to delete' }
    return deleteChannelMessage(ctx.channelId, ctx.messageId, 'Pulse Guard auto-action')
  }

  if (action === 'timeout') {
    if (!ctx.authorId) return { ok: false, error: 'No author to time out' }
    const until = new Date(Date.now() + ctx.timeoutMinutes * 60_000).toISOString()
    return timeoutMemberDiscord(ctx.guildId, ctx.authorId, until, 'Pulse Guard auto-action')
  }

  if (action === 'warn') {
    if (!ctx.authorId) return { ok: false, error: 'No author to warn' }
    const supabase = await createClient()
    const { error } = await supabase.from('guild_warnings').insert({
      guild_id: ctx.guildId,
      user_id: ctx.authorId,
      username: ctx.authorUsername,
      moderator_id: 'pulse-guard',
      moderator_username: 'Pulse Guard',
      reason: 'Pulse Guard auto-action',
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  // Unreachable — TypeScript narrows `action` to never here.
  return { ok: false, error: 'Unsupported action' }
}

/**
 * Build the Pulse Guard alert as a Components V2 Container.
 *
 * Visual approach: minimal. Severity comes through the container's left-edge
 * accent stripe; section dividers do the rhythm work; labels are bold plain
 * text with `:` delimiters. Heuristics and Pulse Guard verdicts render
 * inline (comma-separated, one line each) so the alert stays scannable.
 */
function buildAlertContainer(ctx: {
  verdict: AnalysisVerdict
  executedAction: AutoAction
  channelId: string | null
  channelName: string | null
  authorId: string | null
  authorName: string | null
  authorUsername: string | null
  messageContent: string
  hasIcon: boolean
  accentColor: number
}): V2Container {
  const { verdict, executedAction } = ctx
  const category = verdict.topCategory
  const categoryLabel = category ? CATEGORY_LABELS[category] : 'Content'
  const severityLabel = SEVERITY_LABEL[verdict.severity]
  const actionLabel = ACTION_LABEL[executedAction]
  const pct = Math.round(verdict.confidence * 100)

  // Author — when we have the Discord user ID, render a real `<@id>` mention
  // so it's a clickable pill (shows the member's current display name). Append
  // the raw @username for clarity. Falls back to plain text when no ID.
  const plainAuthor = ctx.authorName
    ? ctx.authorUsername && ctx.authorUsername !== ctx.authorName
      ? `${ctx.authorName} (@${ctx.authorUsername})`
      : ctx.authorName
    : ctx.authorUsername
      ? `@${ctx.authorUsername}`
      : 'Unknown'
  const authorDisplay = ctx.authorId
    ? `<@${ctx.authorId}>${ctx.authorUsername ? ` (@${ctx.authorUsername})` : ''}`
    : plainAuthor

  // Channel — `<#id>` renders as a clickable channel link. Falls back to a
  // plain #name when the ID is missing.
  const channelDisplay = ctx.channelId
    ? `<#${ctx.channelId}>`
    : ctx.channelName
      ? `#${ctx.channelName}`
      : '—'

  const components: V2Container['components'] = []

  // Header — bundled Pulse Guard icon as Section thumbnail accessory. Falls
  // back to plain TextDisplay header if the PNG couldn't be read at startup.
  const headerLines = [
    { type: 10 as const, content: `**Pulse Guard**` },
    { type: 10 as const, content: `# ${categoryLabel} detected` },
    { type: 10 as const, content: `-# ${pct}% confidence` },
  ]
  if (ctx.hasIcon) {
    components.push({
      type: 9,
      components: headerLines,
      accessory: {
        type: 11,
        media: { url: `attachment://${PULSE_GUARD_ICON_FILENAME}` },
        description: 'Pulse Guard',
      },
    })
  } else {
    components.push(...headerLines)
  }

  // Status row — severity + action. `:` delimiter, no emoji noise. The
  // divider that used to sit between the header and this row was removed
  // so the alert flows tighter from brand → status.
  components.push({
    type: 10,
    content:
      `**Severity:** ${severityLabel}\n` +
      `**Action:** ${actionLabel}`,
  })

  components.push({ type: 14, divider: true, spacing: 1 })

  // Context block. Author + channel are clickable Discord mentions.
  components.push({
    type: 10,
    content:
      `**Author:** ${authorDisplay}\n` +
      `**Channel:** ${channelDisplay}`,
  })

  // Reasoning — heuristics + Pulse Guard verdict each render as a single
  // bold-prefixed line, comma-separated when there are multiple hits.
  const hasReasoning =
    verdict.heuristicHits.length > 0 || !!verdict.aiReasoning || !!verdict.reasoning
  if (hasReasoning) {
    components.push({ type: 14, divider: true, spacing: 1 })
  }

  const reasoningLines: string[] = []
  if (verdict.heuristicHits.length > 0) {
    reasoningLines.push(`**Heuristics:** ${verdict.heuristicHits.join(', ').slice(0, 1500)}`)
  }
  if (verdict.aiReasoning) {
    reasoningLines.push(`**Pulse Guard:** ${verdict.aiReasoning.slice(0, 1500)}`)
  }
  if (reasoningLines.length === 0 && verdict.reasoning) {
    // Last-resort fallback so the alert always explains itself.
    reasoningLines.push(`**Reason:** ${verdict.reasoning.slice(0, 1500)}`)
  }
  if (reasoningLines.length > 0) {
    components.push({ type: 10, content: reasoningLines.join('\n') })
  }

  components.push({ type: 14, divider: true, spacing: 1 })

  // Quoted message — keeps moderators from chasing the original channel.
  const snippet = ctx.messageContent.slice(0, 1500)
  components.push({
    type: 10,
    content: `**Message:**\n> ${snippet.replace(/\n/g, '\n> ')}`,
  })

  // Footer — V2 has no native footer, so a final subtext (`-#`) line plays
  // the role. `<t:UNIX:f>` lets Discord render the timestamp in each
  // viewer's local timezone instead of baking ours in. No divider above —
  // the small grey text already reads as a footer.
  const unix = Math.floor(Date.now() / 1000)
  components.push({
    type: 10,
    content: `-# Pulse Guard · Executed <t:${unix}:f> (<t:${unix}:R>)`,
  })

  return {
    type: 17,
    accent_color: ctx.accentColor,
    components,
  }
}
