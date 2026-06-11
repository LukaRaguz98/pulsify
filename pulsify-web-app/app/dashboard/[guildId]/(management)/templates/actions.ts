'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import {
  fetchGuildChannels,
  fetchGuildRoles,
  createGuildRole,
  getBotHighestRolePosition,
} from '@/lib/discord'
import {
  TEMPLATE_SECTION_KEYS,
  SECTION_META,
  TEMPLATE_LIMITS,
  validateTemplateImport,
  findBuiltin,
  normaliseTemplate,
  sectionKeysPresent,
  type TemplateSections,
  type TemplateSectionKey,
  type TemplateRole,
  type TemplateCategory,
  type ServerTemplate,
} from '@/lib/templates'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/templates`)
}

// ── Capture ──────────────────────────────────────────────────────────────────

export type CaptureInput = {
  name: string
  description: string
  category: TemplateCategory
  icon: string
  sectionKeys: TemplateSectionKey[]
}

/** Build the `sections` snapshot by reading each requested section straight
 *  from where the feature stores it. Channel/role IDs are kept as captured —
 *  apply sanitises them against the *target* server. */
async function captureSections(
  guildId: string,
  keys: TemplateSectionKey[],
): Promise<TemplateSections> {
  const supabase = await createClient()
  const sections: TemplateSections = {}

  const needsSettings = keys.some((k) => ['automations', 'moderation', 'pulse', 'onboarding'].includes(k))
  const [settingsRow, aiRow, ticketRow, roles] = await Promise.all([
    needsSettings
      ? supabase.from('guild_settings').select('settings').eq('guild_id', guildId).maybeSingle()
      : Promise.resolve({ data: null }),
    keys.includes('pulse_guard')
      ? supabase.from('ai_moderation_settings').select('enabled, sensitivity, settings').eq('guild_id', guildId).maybeSingle()
      : Promise.resolve({ data: null }),
    keys.includes('tickets')
      ? supabase.from('ticket_configs').select('*').eq('guild_id', guildId).maybeSingle()
      : Promise.resolve({ data: null }),
    keys.includes('roles') ? fetchGuildRoles(guildId) : Promise.resolve([]),
  ])

  const settings = ((settingsRow?.data as { settings?: Record<string, unknown> } | null)?.settings) ?? {}
  const pick = (obj: Record<string, unknown>, srcKeys: string[]) => {
    const out: Record<string, unknown> = {}
    for (const k of srcKeys) if (obj[k] != null) out[k] = obj[k]
    return out
  }

  for (const key of keys) {
    switch (key) {
      case 'automations': {
        const v = pick(settings, ['welcome', 'goodbye', 'auto_role'])
        if (Object.keys(v).length) sections.automations = v
        break
      }
      case 'moderation': {
        const v = pick(settings, ['moderation_alerts'])
        if (Object.keys(v).length) sections.moderation = v
        break
      }
      case 'pulse': {
        const v = pick(settings, ['rules', 'channels_reference'])
        if (Object.keys(v).length) sections.pulse = v
        break
      }
      case 'onboarding': {
        const v = pick(settings, ['onboarding'])
        if (Object.keys(v).length) sections.onboarding = v
        break
      }
      case 'pulse_guard': {
        const row = aiRow?.data as { enabled?: boolean; sensitivity?: string; settings?: Record<string, unknown> } | null
        if (row) {
          sections.pulse_guard = {
            enabled: row.enabled ?? false,
            sensitivity: row.sensitivity ?? 'medium',
            settings: (row.settings as Record<string, unknown>) ?? {},
          }
        }
        break
      }
      case 'tickets': {
        const row = ticketRow?.data as Record<string, unknown> | null
        if (row) {
          // Keep portable config; drop origin-specific channels/counters.
          sections.tickets = {
            enabled: row.enabled ?? false,
            panel: row.panel ?? {},
            ticket_types: row.ticket_types ?? [],
            support_role_ids: row.support_role_ids ?? [],
            naming_format: row.naming_format ?? 'ticket-{number}',
            opening_message: row.opening_message ?? null,
            auto_close: row.auto_close ?? {},
            per_user_limit: row.per_user_limit ?? 1,
            ping_support: row.ping_support ?? true,
          }
        }
        break
      }
      case 'roles': {
        const captured: TemplateRole[] = (roles as Awaited<ReturnType<typeof fetchGuildRoles>>)
          .filter((r) => r.id !== guildId && !r.managed)
          .sort((a, b) => b.position - a.position)
          .slice(0, TEMPLATE_LIMITS.maxRoles)
          .map((r) => ({
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            mentionable: r.mentionable,
            permissions: r.permissions,
          }))
        if (captured.length) sections.roles = captured
        break
      }
    }
  }

  return sections
}

export async function captureTemplate(
  guildId: string,
  input: CaptureInput,
): Promise<ActionResult<ServerTemplate>> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const name = input.name.trim().slice(0, TEMPLATE_LIMITS.nameMax)
  if (!name) return { ok: false, error: 'Give the template a name.' }
  const keys = input.sectionKeys.filter((k) => TEMPLATE_SECTION_KEYS.includes(k))
  if (keys.length === 0) return { ok: false, error: 'Select at least one section to capture.' }

  const sections = await captureSections(guildId, keys)
  if (sectionKeysPresent(sections).length === 0)
    return { ok: false, error: 'None of the selected sections had any configuration to capture.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('server_templates')
    .insert({
      guild_id: guildId,
      name,
      description: input.description.trim().slice(0, TEMPLATE_LIMITS.descriptionMax) || null,
      category: input.category,
      icon: input.icon,
      sections,
      author_id: auth.moderator.userId,
      author_name: auth.moderator.username,
    })
    .select('*')
    .single()

  if (error || !data) return { ok: false, error: `Failed to save template: ${error?.message ?? 'unknown error'}` }

  revalidate(guildId)
  return { ok: true, data: normaliseTemplate(data as Record<string, unknown>) }
}

// ── Import ───────────────────────────────────────────────────────────────────

export async function importTemplate(
  guildId: string,
  raw: unknown,
): Promise<ActionResult<ServerTemplate>> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const parsed = validateTemplateImport(raw)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('server_templates')
    .insert({
      guild_id: guildId,
      name: parsed.value.name,
      description: parsed.value.description,
      category: parsed.value.category,
      icon: parsed.value.icon,
      sections: parsed.value.sections,
      author_id: auth.moderator.userId,
      author_name: auth.moderator.username,
    })
    .select('*')
    .single()

  if (error || !data) return { ok: false, error: `Failed to import template: ${error?.message ?? 'unknown error'}` }
  revalidate(guildId)
  return { ok: true, data: normaliseTemplate(data as Record<string, unknown>) }
}

// ── Update meta / delete ─────────────────────────────────────────────────────

export async function updateTemplateMeta(
  guildId: string,
  templateId: string,
  meta: { name: string; description: string; category: TemplateCategory; icon: string },
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const name = meta.name.trim().slice(0, TEMPLATE_LIMITS.nameMax)
  if (!name) return { ok: false, error: 'Give the template a name.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('server_templates')
    .update({
      name,
      description: meta.description.trim().slice(0, TEMPLATE_LIMITS.descriptionMax) || null,
      category: meta.category,
      icon: meta.icon,
      updated_at: new Date().toISOString(),
    })
    .eq('id', templateId)

  if (error) return { ok: false, error: `Failed to update template: ${error.message}` }
  revalidate(guildId)
  return { ok: true }
}

export async function deleteTemplate(guildId: string, templateId: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const { error } = await supabase.from('server_templates').delete().eq('id', templateId)
  if (error) return { ok: false, error: `Failed to delete template: ${error.message}` }
  revalidate(guildId)
  return { ok: true }
}

// ── Apply ────────────────────────────────────────────────────────────────────

export type ApplyInput = {
  /** Exactly one of these identifies the template. */
  templateId?: string
  builtinId?: string
  /** Which captured sections to apply (partial import). */
  sectionKeys: TemplateSectionKey[]
}

export type ApplySummary = {
  applied: { key: TemplateSectionKey; label: string; detail: string }[]
  warnings: string[]
}

async function loadTemplate(templateId?: string, builtinId?: string): Promise<ServerTemplate | null> {
  if (builtinId) return findBuiltin(builtinId) ?? null
  if (!templateId) return null
  const supabase = await createClient()
  const { data } = await supabase.from('server_templates').select('*').eq('id', templateId).maybeSingle()
  return data ? normaliseTemplate(data as Record<string, unknown>) : null
}

export async function applyTemplate(
  guildId: string,
  input: ApplyInput,
): Promise<ActionResult<ApplySummary>> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const template = await loadTemplate(input.templateId, input.builtinId)
  if (!template) return { ok: false, error: 'Template not found.' }

  const present = sectionKeysPresent(template.sections)
  const keys = input.sectionKeys.filter((k) => present.includes(k))
  if (keys.length === 0) return { ok: false, error: 'Select at least one section to apply.' }

  const supabase = await createClient()
  const applied: ApplySummary['applied'] = []
  const warnings: string[] = []

  // Build the target server's id sets for reference sanitisation.
  const needsRefs = keys.some((k) => ['automations', 'moderation', 'pulse', 'pulse_guard', 'tickets'].includes(k))
  const [channels, roles] = await Promise.all([
    needsRefs ? fetchGuildChannels(guildId) : Promise.resolve([]),
    keys.some((k) => ['automations', 'pulse_guard', 'tickets', 'roles'].includes(k))
      ? fetchGuildRoles(guildId)
      : Promise.resolve([]),
  ])
  const channelIds = new Set(channels.map((c) => c.id))
  const roleIds = new Set(roles.map((r) => r.id))
  const keepRoleList = (ids: unknown): string[] =>
    Array.isArray(ids) ? (ids as unknown[]).filter((id) => typeof id === 'string' && roleIds.has(id)) as string[] : []

  let droppedRefs = 0
  const sanitiseChannel = (obj: Record<string, unknown> | undefined, field = 'channel_id') => {
    if (!obj || typeof obj[field] !== 'string' || !obj[field]) return
    if (!channelIds.has(obj[field] as string)) {
      obj[field] = ''
      droppedRefs++
    }
  }

  // ── guild_settings-backed sections: collect, sanitise, single upsert ──
  const settingsKeys = keys.filter((k) => ['automations', 'moderation', 'pulse', 'onboarding'].includes(k))
  if (settingsKeys.length) {
    const { data: existing } = await supabase
      .from('guild_settings')
      .select('settings')
      .eq('guild_id', guildId)
      .maybeSingle()
    const merged: Record<string, unknown> = { ...((existing?.settings as Record<string, unknown>) ?? {}) }

    for (const key of settingsKeys) {
      const section = (template.sections[key] ?? {}) as Record<string, unknown>
      // Deep-ish clone so we can sanitise without mutating the template object.
      const block = JSON.parse(JSON.stringify(section)) as Record<string, unknown>

      if (key === 'automations') {
        sanitiseChannel(block.welcome as Record<string, unknown> | undefined)
        sanitiseChannel(block.goodbye as Record<string, unknown> | undefined)
        const autoRole = block.auto_role as Record<string, unknown> | undefined
        if (autoRole && typeof autoRole.role_id === 'string' && autoRole.role_id && !roleIds.has(autoRole.role_id)) {
          autoRole.role_id = ''
          autoRole.enabled = false
          droppedRefs++
        }
      } else if (key === 'moderation') {
        sanitiseChannel(block.moderation_alerts as Record<string, unknown> | undefined)
      } else if (key === 'pulse') {
        sanitiseChannel(block.rules as Record<string, unknown> | undefined)
      }

      Object.assign(merged, block)
      applied.push({
        key,
        label: SECTION_META[key].label,
        detail: `${Object.keys(block).length} setting${Object.keys(block).length === 1 ? '' : 's'} applied`,
      })
    }

    const { error } = await supabase
      .from('guild_settings')
      .upsert({ guild_id: guildId, settings: merged, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    if (error) return { ok: false, error: `Failed to apply settings: ${error.message}` }
  }

  // ── Pulse Guard ──
  if (keys.includes('pulse_guard') && template.sections.pulse_guard) {
    const pg = JSON.parse(JSON.stringify(template.sections.pulse_guard)) as {
      enabled?: boolean
      sensitivity?: string
      settings?: Record<string, unknown>
    }
    const s = (pg.settings ?? {}) as Record<string, unknown>
    if (typeof s.alert_channel_id === 'string' && !channelIds.has(s.alert_channel_id)) {
      s.alert_channel_id = null
      droppedRefs++
    }
    s.whitelisted_role_ids = keepRoleList(s.whitelisted_role_ids)
    s.ignored_channel_ids = Array.isArray(s.ignored_channel_ids)
      ? (s.ignored_channel_ids as unknown[]).filter((id) => typeof id === 'string' && channelIds.has(id))
      : []
    s.whitelisted_user_ids = Array.isArray(s.whitelisted_user_ids) ? s.whitelisted_user_ids : []

    const { error } = await supabase.from('ai_moderation_settings').upsert(
      {
        guild_id: guildId,
        enabled: pg.enabled ?? false,
        sensitivity: pg.sensitivity ?? 'medium',
        settings: s,
        updated_by: auth.moderator.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'guild_id' },
    )
    if (error) return { ok: false, error: `Failed to apply Pulse Guard: ${error.message}` }
    applied.push({
      key: 'pulse_guard',
      label: SECTION_META.pulse_guard.label,
      detail: pg.enabled ? 'Enabled with detectors' : 'Configured (disabled)',
    })
  }

  // ── Tickets ──
  if (keys.includes('tickets') && template.sections.tickets) {
    const t = JSON.parse(JSON.stringify(template.sections.tickets)) as Record<string, unknown>
    const supportRoles = keepRoleList(t.support_role_ids)
    const { error } = await supabase.from('ticket_configs').upsert(
      {
        guild_id: guildId,
        enabled: t.enabled === true,
        panel: t.panel ?? {},
        ticket_types: t.ticket_types ?? [],
        support_role_ids: supportRoles,
        naming_format: typeof t.naming_format === 'string' ? t.naming_format : 'ticket-{number}',
        opening_message: (t.opening_message as string | null) ?? null,
        auto_close: t.auto_close ?? {},
        per_user_limit: Number(t.per_user_limit ?? 1),
        ping_support: t.ping_support !== false,
        updated_by: auth.moderator.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'guild_id' },
    )
    if (error) return { ok: false, error: `Failed to apply tickets: ${error.message}` }
    const typeCount = Array.isArray(t.ticket_types) ? t.ticket_types.length : 0
    applied.push({
      key: 'tickets',
      label: SECTION_META.tickets.label,
      detail: `Panel + ${typeCount} type${typeCount === 1 ? '' : 's'}`,
    })
    if (Array.isArray(t.support_role_ids) && t.support_role_ids.length && supportRoles.length === 0)
      warnings.push('Ticket support roles were cleared — set support roles in Ticket settings.')
  }

  // ── Roles (create missing by name) ──
  if (keys.includes('roles') && Array.isArray(template.sections.roles)) {
    const botTop = await getBotHighestRolePosition(guildId)
    const existingNames = new Set(roles.map((r) => r.name.toLowerCase()))
    let created = 0
    let skipped = 0
    let failed = 0
    for (const r of template.sections.roles) {
      if (existingNames.has(r.name.toLowerCase())) {
        skipped++
        continue
      }
      const res = await createGuildRole(
        guildId,
        {
          name: r.name,
          color: r.color,
          hoist: r.hoist,
          mentionable: r.mentionable,
          // Don't grant administrative/dangerous perms blindly across servers —
          // capture stores the bitfield but we apply a safe-by-default empty
          // permission set; admins grant perms deliberately afterwards.
          permissions: '0',
        },
        `Applied from template "${template.name}"`,
      )
      if (res.ok) {
        created++
        existingNames.add(r.name.toLowerCase())
      } else {
        failed++
      }
    }
    const parts: string[] = []
    if (created) parts.push(`${created} created`)
    if (skipped) parts.push(`${skipped} already existed`)
    if (failed) parts.push(`${failed} failed`)
    applied.push({ key: 'roles', label: SECTION_META.roles.label, detail: parts.join(', ') || 'No changes' })
    if (failed) warnings.push(`${failed} role${failed === 1 ? '' : 's'} could not be created — check the bot's role position and permissions.`)
    if (created) warnings.push('New roles were created at the bottom of the list — reorder them and grant permissions as needed.')
    if (botTop == null) warnings.push("Couldn't confirm the bot's role position; some roles may not have been created.")
  }

  if (droppedRefs > 0)
    warnings.push(`${droppedRefs} channel/role reference${droppedRefs === 1 ? '' : 's'} pointed to another server and ${droppedRefs === 1 ? 'was' : 'were'} cleared — reselect them in each feature.`)

  // Bump usage on saved (non-builtin) templates.
  if (template.builtin === false && input.templateId) {
    await supabase
      .from('server_templates')
      .update({ usage_count: template.usageCount + 1 })
      .eq('id', template.id)
  }

  await recordNotification({
    guildId,
    type: 'server_settings_changed',
    severity: 'info',
    title: `Applied template "${template.name}"`,
    body: `${applied.map((a) => a.label).join(', ')} updated.`,
    link: `/dashboard/${guildId}/templates`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
  })

  revalidate(guildId)
  return { ok: true, data: { applied, warnings } }
}

// ── Quick Setup ────────────────────────────────────────────────────────────────
// The overview "Quick setup" wizard generates a configuration from a handful of
// preferences (see lib/quick-setup.ts) and saves it as an editable library
// template — optionally applying it to this server straight away.

export type QuickSetupSaveInput = {
  name: string
  description: string
  category: TemplateCategory
  icon: string
  sections: TemplateSections
  /** Apply the generated config to this server immediately after saving. */
  apply: boolean
}

export async function createQuickSetupTemplate(
  guildId: string,
  input: QuickSetupSaveInput,
): Promise<ActionResult<{ template: ServerTemplate; summary: ApplySummary | null }>> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  // Run the generated config through the import validator so it gets the same
  // guarantees as an imported file (known sections only, role cap, coercion).
  const parsed = validateTemplateImport({
    name: input.name,
    description: input.description,
    category: input.category,
    icon: input.icon,
    sections: input.sections,
  })
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('server_templates')
    .insert({
      guild_id: guildId,
      name: parsed.value.name,
      description: parsed.value.description,
      category: parsed.value.category,
      icon: parsed.value.icon,
      sections: parsed.value.sections,
      author_id: auth.moderator.userId,
      author_name: auth.moderator.username,
    })
    .select('*')
    .single()

  if (error || !data)
    return { ok: false, error: `Failed to save setup: ${error?.message ?? 'unknown error'}` }

  const template = normaliseTemplate(data as Record<string, unknown>)

  // Optionally apply it now. A failed apply doesn't lose the saved template —
  // we surface the reason as a warning so the admin can apply it from the library.
  let summary: ApplySummary | null = null
  if (input.apply) {
    const res = await applyTemplate(guildId, {
      templateId: template.id,
      sectionKeys: sectionKeysPresent(template.sections),
    })
    summary = res.ok ? res.data : { applied: [], warnings: [res.error] }
  }

  revalidate(guildId)
  return { ok: true, data: { template, summary } }
}
