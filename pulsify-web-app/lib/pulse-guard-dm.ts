import 'server-only'
import { openDMChannel, postChannelComponents, type V2Container, type V2Attachment } from '@/lib/discord'
import { getTintedPulseIcon, pulseIconFilename } from '@/lib/pulse-icon'

const WARN_ICON_FILENAME = pulseIconFilename('warn')

/** Parse a `#rrggbb` hex string into a Discord-compatible integer. */
function hexToInt(hex: string, fallback = 0x8b5cf6): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return fallback
  const n = parseInt(m[1], 16)
  return Number.isFinite(n) ? n : fallback
}

export type WarningDMOptions = {
  /** Discord user ID of the warned member. */
  userId: string
  /** Server the warning came from — shown so the DM has context. */
  guildName: string
  /** Why they were warned (verdict reasoning or moderator note). */
  reason: string
  /** Top detection category label, e.g. "Toxicity". Optional. */
  categoryLabel?: string | null
  /** Severity label, e.g. "High". Optional. */
  severityLabel?: string | null
  /** Pulse Guard accent colour (hex, e.g. '#8b5cf6'). */
  embedColor: string
}

/**
 * Build the warning DM as a Components V2 Container.
 *
 * Mirrors the Pulse Guard alert layout (header with the bundled badge as a
 * Section thumbnail, accent stripe in the guild colour, bold-prefixed context
 * lines, `-#` subtext footer) so a warned member sees the same visual language
 * moderators see in the alert channel.
 */
export function buildWarningDMContainer(
  opts: Omit<WarningDMOptions, 'userId'>,
  hasIcon: boolean,
): V2Container {
  const components: V2Container['components'] = []

  const headerLines = [
    { type: 10 as const, content: `**Pulse**` },
    { type: 10 as const, content: `# Warning issued` },
    { type: 10 as const, content: `-# Pulse Guard — ${opts.guildName}` },
  ]
  if (hasIcon) {
    components.push({
      type: 9,
      components: headerLines,
      accessory: {
        type: 11,
        media: { url: `attachment://${WARN_ICON_FILENAME}` },
        description: 'Pulse Guard',
      },
    })
  } else {
    components.push(...headerLines)
  }

  // Status row — category + severity, same `:` delimiter style as the alert.
  const statusLines: string[] = []
  if (opts.categoryLabel) statusLines.push(`**Reason category:** ${opts.categoryLabel}`)
  if (opts.severityLabel) statusLines.push(`**Severity:** ${opts.severityLabel}`)
  if (statusLines.length > 0) {
    components.push({ type: 10, content: statusLines.join('\n') })
    components.push({ type: 14, divider: true, spacing: 1 })
  }

  // The detail block: what happened + a short behaviour nudge.
  components.push({
    type: 10,
    content:
      `**Details:** ${opts.reason.slice(0, 1500)}\n\n` +
      `Please review the server rules. Repeated violations may lead to further moderation action such as a timeout or removal.`,
  })

  const unix = Math.floor(Date.now() / 1000)
  components.push({
    type: 10,
    content: `-# Pulse — Warning — <t:${unix}:f>`,
  })

  return {
    type: 17,
    accent_color: hexToInt(opts.embedColor),
    components,
  }
}

/**
 * Build the warning embed (container + tinted badge attachment) for the DM.
 */
async function buildWarningPayload(
  opts: Omit<WarningDMOptions, 'userId'>,
): Promise<{ container: V2Container; attachments: V2Attachment[] }> {
  const iconBuffer = await getTintedPulseIcon('warn', opts.embedColor)
  const attachments: V2Attachment[] = iconBuffer
    ? [{ filename: WARN_ICON_FILENAME, data: iconBuffer, contentType: 'image/png' }]
    : []
  const container = buildWarningDMContainer(opts, iconBuffer !== null)
  return { container, attachments }
}

/**
 * Send a warned member a DM that matches the Pulse Guard embed style.
 *
 * Best-effort: returns `false` (never throws) when the bot can't DM the user —
 * the most common reason is the member having DMs from server bots disabled.
 * The warning itself is already recorded by the caller; the DM is a courtesy
 * heads-up, so a failure must not roll anything back.
 */
export async function sendPulseGuardWarningDM(opts: WarningDMOptions): Promise<boolean> {
  try {
    const channelId = await openDMChannel(opts.userId)
    if (!channelId) return false

    const { container, attachments } = await buildWarningPayload({
      guildName: opts.guildName,
      reason: opts.reason,
      categoryLabel: opts.categoryLabel,
      severityLabel: opts.severityLabel,
      embedColor: opts.embedColor,
    })

    const res = await postChannelComponents(channelId, [container], attachments)
    return res.ok
  } catch (err) {
    console.warn(`[PulseGuard] warning DM to ${opts.userId} failed:`, err)
    return false
  }
}
