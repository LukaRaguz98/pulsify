import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles, CHANNEL_TYPES } from '@/lib/discord'
import { TemplatesContent } from '@/components/dashboard/templates/TemplatesContent'
import {
  normaliseTemplate,
  sectionKeysPresent,
  type ServerTemplate,
  type TemplateSectionKey,
} from '@/lib/templates'

/** A lightweight snapshot of the *target* server's current configuration —
 *  enough for the apply wizard to detect conflicts (which sections would be
 *  overwritten, which role names already exist) without shipping the whole
 *  config to the client. */
export type GuildConfigSnapshot = {
  /** Section keys that currently hold non-empty config in this server. */
  presentSections: TemplateSectionKey[]
  /** Existing role names (lower-cased) — used to skip duplicates on apply. */
  roleNames: string[]
  channelCount: number
  roleCount: number
}

function settingsHasAny(settings: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((k) => {
    const v = settings[k]
    if (v == null) return false
    if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length > 0
    return true
  })
}

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/')

  // The template library is the signed-in admin's own, reusable across every
  // server they manage (RLS is allow-all; we scope by author for tenancy).
  const authorId = (user.user_metadata?.provider_id as string | undefined) ?? user.id

  const [guild, channels, roles, { data: settingsRow }, { data: aiRow }, { data: ticketRow }, { data: templateRows }] =
    await Promise.all([
      fetchGuild(guildId),
      fetchGuildChannels(guildId),
      fetchGuildRoles(guildId),
      supabase.from('guild_settings').select('settings').eq('guild_id', guildId).maybeSingle(),
      supabase.from('ai_moderation_settings').select('enabled, settings').eq('guild_id', guildId).maybeSingle(),
      supabase.from('ticket_configs').select('enabled, ticket_types').eq('guild_id', guildId).maybeSingle(),
      supabase
        .from('server_templates')
        .select('*')
        .or(`author_id.eq.${authorId},guild_id.eq.${guildId}`)
        .order('created_at', { ascending: false })
        .limit(200),
    ])

  const settings = (settingsRow?.settings as Record<string, unknown>) ?? {}

  // Which sections currently carry config in this server (drives the
  // "this will overwrite existing settings" warnings in the apply wizard).
  const presentSections: TemplateSectionKey[] = []
  if (settingsHasAny(settings, ['welcome', 'goodbye', 'auto_role'])) presentSections.push('automations')
  if (settingsHasAny(settings, ['moderation_alerts'])) presentSections.push('moderation')
  if (settingsHasAny(settings, ['rules', 'channels_reference'])) presentSections.push('pulse')
  if (settingsHasAny(settings, ['onboarding'])) presentSections.push('onboarding')
  if (aiRow && (aiRow.enabled || aiRow.settings)) presentSections.push('pulse_guard')
  if (ticketRow && (ticketRow.enabled || (Array.isArray(ticketRow.ticket_types) && ticketRow.ticket_types.length)))
    presentSections.push('tickets')
  if (roles.filter((r) => r.id !== guildId && !r.managed).length > 0) presentSections.push('roles')

  const assignableRoles = roles.filter((r) => r.id !== guildId && !r.managed)
  const snapshot: GuildConfigSnapshot = {
    presentSections,
    roleNames: assignableRoles.map((r) => r.name.toLowerCase()),
    channelCount: channels.filter((c) => c.type === CHANNEL_TYPES.TEXT).length,
    roleCount: assignableRoles.length,
  }

  // Which sections are even capturable from *this* server right now — so the
  // create panel can disable empty ones instead of capturing nothing.
  const capturable: TemplateSectionKey[] = [...presentSections]

  const templates: ServerTemplate[] = (templateRows ?? []).map((r) =>
    normaliseTemplate(r as Record<string, unknown>),
  )
  // Defensive: hide any persisted rows that ended up with no usable sections.
  const saved = templates.filter((t) => sectionKeysPresent(t.sections).length > 0)

  return (
    <TemplatesContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      savedTemplates={saved}
      snapshot={snapshot}
      capturableSections={capturable}
    />
  )
}
