'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { readGuildEmbedInt } from '@/lib/embed-color'
import { fetchGuild, postChannelComponents, type V2TopLevelComponent } from '@/lib/discord'
import {
  normaliseBirthdaySettings,
  serialiseBirthdaySettings,
  renderBirthdayMessage,
  formatBirthday,
  type BirthdayConfig,
} from '@/lib/birthdays'

export type ActionResult = { ok: true } | { ok: false; error: string }

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/birthdays`)
  revalidatePath(`/dashboard/${guildId}/birthday-settings`)
}

// ── Discord embed (MUST match pulse-bot/src/birthdays.js buildAnnouncement) ────
//
// No header badge: the announcement is a single sentence (plus an optional
// image), so a thumbnail would take more room than the message — the same rule
// the bot follows (see the embed conventions on buildPulseContainer in
// pulse-bot/src/commands.js). The colour is the guild's accent, like every other
// Pulse embed.

const td = (content: string) => ({ type: 10, content })

function birthdayContainer(opts: {
  rendered: string
  ageLine: string | null
  imageUrl: string | null
  buttonLabel: string | null
  buttonUrl: string | null
  subtitle: string
  accent: number
}): V2TopLevelComponent {
  const body: Record<string, unknown>[] = [
    td('**Pulse**'),
    td('# Happy Birthday'),
    td(`-# ${opts.subtitle}`),
  ]
  body.push(td(opts.rendered))
  if (opts.ageLine) body.push(td(`-# ${opts.ageLine}`))
  if (opts.imageUrl) body.push({ type: 12, items: [{ media: { url: opts.imageUrl } }] })
  // The footer carries the width pin (a run of U+2800 blanks) — skipped when an
  // image already defines the width. A spacer of its own would cost a full
  // empty line right under the title.
  const birthdayFooter = 'Pulse — Birthday'
  body.push(td(`-# ${opts.imageUrl ? birthdayFooter : birthdayFooter + '⠀'.repeat(44 - birthdayFooter.length)}`))
  if (opts.buttonLabel && opts.buttonUrl) {
    body.push({ type: 1, components: [{ type: 2, style: 5, label: opts.buttonLabel, url: opts.buttonUrl }] })
  }
  return { type: 17, accent_color: opts.accent, components: body } as unknown as V2TopLevelComponent
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

  const supabase = await createClient()
  const accent = await readGuildEmbedInt(supabase, guildId)

  const res = await postChannelComponents(channelId, [
    birthdayContainer({
      rendered,
      ageLine: 'Turning 21 today',
      imageUrl: clean.image_url,
      buttonLabel: clean.button_label,
      buttonUrl: clean.button_url,
      subtitle: auth.moderator.username ?? 'A member',
      accent,
    }),
  ])
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
