'use server'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { fetchGuild, postChannelComponents, type V2TopLevelComponent, type V2Attachment } from '@/lib/discord'
import {
  normaliseBirthdaySettings,
  serialiseBirthdaySettings,
  renderBirthdayMessage,
  formatBirthday,
  type BirthdayConfig,
} from '@/lib/birthdays'

export type ActionResult = { ok: true } | { ok: false; error: string }

const BRAND = 0x8b5cf6

// Pulse birthday badge — attached as a header thumbnail on the sample embed the
// dashboard posts via "Send test". Identical bytes to the copy the bot ships so
// a birthday looks the same whoever posted it (mirrors milestones/actions.ts).
const ICON_NAME = 'pulse-birthday.png'
let ICON_BUFFER: Buffer | null = null
try {
  ICON_BUFFER = readFileSync(path.join(process.cwd(), 'public', ICON_NAME))
} catch {
  ICON_BUFFER = null
}
const HAS_ICON = ICON_BUFFER !== null
const iconAttachments = (): V2Attachment[] | undefined =>
  HAS_ICON ? [{ filename: ICON_NAME, data: ICON_BUFFER!, contentType: 'image/png' }] : undefined

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/birthdays`)
  revalidatePath(`/dashboard/${guildId}/birthday-settings`)
}

// ── Discord embed (MUST match pulse-bot/src/birthdays.js buildAnnouncement) ────

const td = (content: string) => ({ type: 10, content })

function birthdayContainer(opts: {
  rendered: string
  ageLine: string | null
  imageUrl: string | null
  buttonLabel: string | null
  buttonUrl: string | null
  subtitle: string
}): V2TopLevelComponent {
  const headerLines: Record<string, unknown>[] = [td('**Pulse**'), td('# Happy Birthday'), td(`-# ${opts.subtitle}`)]
  const header: Record<string, unknown>[] = HAS_ICON
    ? [
        {
          type: 9,
          components: headerLines,
          accessory: { type: 11, media: { url: `attachment://${ICON_NAME}` }, description: 'Pulse birthday' },
        },
      ]
    : headerLines
  const body: Record<string, unknown>[] = [...header]
  if (!opts.imageUrl) body.push(td(`-# ${'⠀'.repeat(44)}`)) // width spacer (skipped when an image defines width)
  body.push(td(opts.rendered))
  if (opts.ageLine) body.push(td(`-# ${opts.ageLine}`))
  if (opts.imageUrl) body.push({ type: 12, items: [{ media: { url: opts.imageUrl } }] })
  body.push(td('-# Pulse — Birthday'))
  if (opts.buttonLabel && opts.buttonUrl) {
    body.push({ type: 1, components: [{ type: 2, style: 5, label: opts.buttonLabel, url: opts.buttonUrl }] })
  }
  return { type: 17, accent_color: BRAND, components: body } as unknown as V2TopLevelComponent
}

// ── Save settings ─────────────────────────────────────────────────────────────

/**
 * Persist a guild's birthday configuration. Re-normalised server-side (clamps +
 * defaults + URL validation) so a tampered payload can't write bad values. A
 * missing row means "disabled defaults", so a row is only written on first save.
 */
export async function saveBirthdaySettings(guildId: string, config: BirthdayConfig): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const clean = normaliseBirthdaySettings({
    enabled: config.enabled,
    settings: config as unknown as Record<string, unknown>,
  })
  if (clean.enabled && !clean.channel_id) {
    return { ok: false, error: 'Pick an announcement channel before enabling birthdays.' }
  }
  const { enabled, settings } = serialiseBirthdaySettings(clean)

  const supabase = await createClient()
  const { error } = await supabase.from('birthday_settings').upsert(
    { guild_id: guildId, enabled, settings, updated_at: new Date().toISOString() },
    { onConflict: 'guild_id' },
  )
  if (error) return { ok: false, error: error.message }

  revalidate(guildId)
  return { ok: true }
}

// ── Send a test announcement ──────────────────────────────────────────────────

export async function testBirthdayAnnouncement(
  guildId: string,
  config: BirthdayConfig,
  channelId: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  if (!channelId) return { ok: false, error: 'Pick a channel to send the test to.' }

  const clean = normaliseBirthdaySettings({ enabled: config.enabled, settings: config as unknown as Record<string, unknown> })
  const guild = await fetchGuild(guildId).catch(() => null)
  const mentionText =
    clean.mention === 'everyone' ? '@everyone' : clean.mention === 'here' ? '@here' : `<@${auth.moderator.userId}>`
  const rendered = renderBirthdayMessage(clean.message, {
    user: auth.moderator.username ?? 'member',
    mention: mentionText,
    server: guild?.name ?? 'this server',
    age: 21,
    date: formatBirthday(3, 14, 2004, true),
  })

  const res = await postChannelComponents(
    channelId,
    [
      birthdayContainer({
        rendered,
        ageLine: 'Turning 21 today',
        imageUrl: clean.image_url,
        buttonLabel: clean.button_label,
        buttonUrl: clean.button_url,
        subtitle: auth.moderator.username ?? 'A member',
      }),
    ],
    iconAttachments(),
  )
  if (!res.ok) return { ok: false, error: `Couldn't post the test: ${res.error}` }
  return { ok: true }
}

// ── Admin: remove a member's birthday ─────────────────────────────────────────

export async function removeMemberBirthday(guildId: string, userId: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase
    .from('member_birthdays')
    .delete()
    .eq('guild_id', guildId)
    .eq('user_id', userId)
  if (error) return { ok: false, error: error.message }

  revalidate(guildId)
  return { ok: true }
}
