'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import { recordTimelineEvent } from '@/lib/timeline-server'
import { getCurrentUserPlan, requireGuildLimit } from '@/lib/billing-server'
import { hasPlan } from '@/lib/billing'
import {
  FEATURE_META,
  TEMPLATE_LIMITS,
  validateTemplateImport,
  findBuiltin,
  normaliseTemplate,
  normaliseFeatureMap,
  featureKeysDecided,
  type FeatureKey,
  type FeatureMap,
  type TemplateCategory,
  type ServerTemplate,
} from '@/lib/templates'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/templates`)
}

type SB = Awaited<ReturnType<typeof createClient>>

/**
 * Plan limit (PULSIFY-62): saved custom templates per guild, gated on the
 * server owner's plan. Shared by saveTemplate + importTemplate (both create a
 * server_templates row). Built-in presets don't count — they aren't stored.
 */
async function checkSavedTemplateLimit(
  supabase: SB,
  guildId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { count } = await supabase
    .from('server_templates')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId)
  const gate = await requireGuildLimit(guildId, 'maxSavedTemplates', count ?? 0)
  return gate.ok ? { ok: true } : { ok: false, error: gate.error }
}

// ── Read the server's current feature on/off states ──────────────────────────
// Shared by the page (to seed the create panel + preview) and capture.

export async function readCurrentFeatures(guildId: string): Promise<FeatureMap> {
  const supabase = await createClient()
  return readFeatures(supabase, guildId)
}

async function readFeatures(supabase: SB, guildId: string): Promise<FeatureMap> {
  const [settingsRow, ai, sec, tkt, pc, lvl, eco] = await Promise.all([
    supabase.from('guild_settings').select('settings').eq('guild_id', guildId).maybeSingle(),
    supabase.from('ai_moderation_settings').select('enabled').eq('guild_id', guildId).maybeSingle(),
    supabase.from('security_configs').select('enabled').eq('guild_id', guildId).maybeSingle(),
    supabase.from('ticket_configs').select('enabled').eq('guild_id', guildId).maybeSingle(),
    supabase.from('private_channel_configs').select('enabled').eq('guild_id', guildId).maybeSingle(),
    supabase.from('leveling_settings').select('enabled').eq('guild_id', guildId).maybeSingle(),
    supabase.from('economy_reward_settings').select('enabled').eq('guild_id', guildId).maybeSingle(),
  ])

  const settings = ((settingsRow.data as { settings?: Record<string, unknown> } | null)?.settings) ?? {}
  const sub = (k: string) => settings[k] as Record<string, unknown> | undefined

  return {
    automations: Boolean(sub('welcome')?.enabled || sub('goodbye')?.enabled),
    onboarding: Boolean(sub('member_onboarding')?.enabled),
    moderation_alerts: Boolean(sub('moderation_alerts')?.enabled),
    pulse_guard: Boolean(ai.data?.enabled),
    ddos_protection: Boolean(sec.data?.enabled),
    tickets: Boolean(tkt.data?.enabled),
    private_channels: Boolean(pc.data?.enabled),
    // Leveling + economy are on by default (a missing row means "enabled").
    leveling: lvl.data ? Boolean(lvl.data.enabled) : true,
    economy: eco.data ? Boolean(eco.data.enabled) : true,
  }
}

// ── Apply: flip each decided feature's master enable flag ─────────────────────

const SETTINGS_FEATURES: FeatureKey[] = ['automations', 'onboarding', 'moderation_alerts']

export type ApplySummary = {
  applied: { key: FeatureKey; label: string; enabled: boolean; detail: string }[]
  warnings: string[]
}

async function applyFeatures(
  supabase: SB,
  guildId: string,
  features: FeatureMap,
  updatedBy: string,
  onlyKeys?: FeatureKey[],
): Promise<ApplySummary> {
  const keys = featureKeysDecided(features).filter((k) => !onlyKeys || onlyKeys.includes(k))
  const applied: ApplySummary['applied'] = []
  const warnings: string[] = []
  const nowIso = new Date().toISOString()

  // guild_settings-backed toggles — read once, mutate, single upsert.
  const settingsKeys = keys.filter((k) => SETTINGS_FEATURES.includes(k))
  if (settingsKeys.length) {
    const { data: existing } = await supabase
      .from('guild_settings')
      .select('settings')
      .eq('guild_id', guildId)
      .maybeSingle()
    const settings: Record<string, unknown> = { ...((existing?.settings as Record<string, unknown>) ?? {}) }
    const setSub = (subKey: string, enabled: boolean) => {
      const cur = (settings[subKey] as Record<string, unknown> | undefined) ?? {}
      settings[subKey] = { ...cur, enabled }
    }
    for (const key of settingsKeys) {
      const enabled = features[key] === true
      if (key === 'automations') {
        setSub('welcome', enabled)
        setSub('goodbye', enabled)
      } else if (key === 'onboarding') {
        setSub('member_onboarding', enabled)
      } else if (key === 'moderation_alerts') {
        setSub('moderation_alerts', enabled)
      }
      applied.push({ key, label: FEATURE_META[key].label, enabled, detail: enabled ? 'Turned on' : 'Turned off' })
    }
    const { error } = await supabase
      .from('guild_settings')
      .upsert({ guild_id: guildId, settings, updated_at: nowIso }, { onConflict: 'guild_id' })
    if (error) return { applied: [], warnings: [`Failed to update settings: ${error.message}`] }
  }

  // Single-table toggles — minimal upsert; all other columns are DB-defaulted.
  const tableFor: Partial<Record<FeatureKey, { table: string; withUpdatedBy?: boolean }>> = {
    pulse_guard: { table: 'ai_moderation_settings', withUpdatedBy: true },
    ddos_protection: { table: 'security_configs', withUpdatedBy: true },
    tickets: { table: 'ticket_configs', withUpdatedBy: true },
    private_channels: { table: 'private_channel_configs' },
    leveling: { table: 'leveling_settings' },
    economy: { table: 'economy_reward_settings' },
  }

  for (const key of keys) {
    const target = tableFor[key]
    if (!target) continue
    const enabled = features[key] === true
    const payload: Record<string, unknown> = { guild_id: guildId, enabled, updated_at: nowIso }
    if (target.withUpdatedBy) payload.updated_by = updatedBy
    const { error } = await supabase.from(target.table).upsert(payload, { onConflict: 'guild_id' })
    if (error) {
      warnings.push(`Couldn't update ${FEATURE_META[key].label}: ${error.message}`)
      continue
    }
    applied.push({ key, label: FEATURE_META[key].label, enabled, detail: enabled ? 'Turned on' : 'Turned off' })
  }

  return { applied, warnings }
}

// ── Save (capture current profile as a template) ─────────────────────────────

export type SaveInput = {
  name: string
  description: string
  category: TemplateCategory
  icon: string
  features: FeatureMap
}

export async function saveTemplate(
  guildId: string,
  input: SaveInput,
): Promise<ActionResult<ServerTemplate>> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const name = input.name.trim().slice(0, TEMPLATE_LIMITS.nameMax)
  if (!name) return { ok: false, error: 'Give the template a name.' }
  const features = normaliseFeatureMap(input.features)
  if (featureKeysDecided(features).length === 0) return { ok: false, error: 'Choose what this template turns on or off.' }

  const supabase = await createClient()

  const saveLimit = await checkSavedTemplateLimit(supabase, guildId)
  if (!saveLimit.ok) return { ok: false, error: saveLimit.error }

  const { data, error } = await supabase
    .from('server_templates')
    .insert({
      guild_id: guildId,
      name,
      description: input.description.trim().slice(0, TEMPLATE_LIMITS.descriptionMax) || null,
      category: input.category,
      icon: input.icon,
      features,
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

export async function importTemplate(guildId: string, raw: unknown): Promise<ActionResult<ServerTemplate>> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const parsed = validateTemplateImport(raw)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const supabase = await createClient()

  const importLimit = await checkSavedTemplateLimit(supabase, guildId)
  if (!importLimit.ok) return { ok: false, error: importLimit.error }

  const { data, error } = await supabase
    .from('server_templates')
    .insert({
      guild_id: guildId,
      name: parsed.value.name,
      description: parsed.value.description,
      category: parsed.value.category,
      icon: parsed.value.icon,
      features: parsed.value.features,
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
  meta: { name: string; description: string; category: TemplateCategory; icon: string; features?: FeatureMap },
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const name = meta.name.trim().slice(0, TEMPLATE_LIMITS.nameMax)
  if (!name) return { ok: false, error: 'Give the template a name.' }

  const update: Record<string, unknown> = {
    name,
    description: meta.description.trim().slice(0, TEMPLATE_LIMITS.descriptionMax) || null,
    category: meta.category,
    icon: meta.icon,
    updated_at: new Date().toISOString(),
  }
  if (meta.features) update.features = normaliseFeatureMap(meta.features)

  const supabase = await createClient()
  const { error } = await supabase.from('server_templates').update(update).eq('id', templateId).eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to update template: ${error.message}` }
  revalidate(guildId)
  return { ok: true }
}

export async function deleteTemplate(guildId: string, templateId: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const { error } = await supabase.from('server_templates').delete().eq('id', templateId).eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to delete template: ${error.message}` }
  revalidate(guildId)
  return { ok: true }
}

// ── Apply ────────────────────────────────────────────────────────────────────

export type ApplyInput = {
  templateId?: string
  builtinId?: string
  /** Restrict the apply to these feature keys (partial apply). Omit = all decided. */
  featureKeys?: FeatureKey[]
}

async function loadTemplate(templateId?: string, builtinId?: string): Promise<ServerTemplate | null> {
  if (builtinId) return findBuiltin(builtinId) ?? null
  if (!templateId) return null
  const supabase = await createClient()
  const { data } = await supabase.from('server_templates').select('*').eq('id', templateId).maybeSingle()
  return data ? normaliseTemplate(data as Record<string, unknown>) : null
}

export async function applyTemplate(guildId: string, input: ApplyInput): Promise<ActionResult<ApplySummary>> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const template = await loadTemplate(input.templateId, input.builtinId)
  if (!template) return { ok: false, error: 'Template not found.' }

  const decided = featureKeysDecided(template.features)
  const keys = input.featureKeys ? decided.filter((k) => input.featureKeys!.includes(k)) : decided
  if (keys.length === 0) return { ok: false, error: 'Select at least one feature to apply.' }

  // Plan gating: a feature locked behind a paid plan can only be TURNED ON by a
  // user whose plan covers it. (During early access getCurrentUserPlan returns
  // the top tier, so nothing is blocked until early access ends.) Disabling a
  // feature is always allowed. This is the security boundary — the UI also locks
  // these toggles, but never trust the client.
  const plan = await getCurrentUserPlan()
  const lockedSkipped: string[] = []
  const effectiveKeys = keys.filter((k) => {
    const wantOn = template.features[k] === true
    const required = FEATURE_META[k].plan
    if (wantOn && required !== 'free' && !hasPlan(plan, required)) {
      lockedSkipped.push(FEATURE_META[k].label)
      return false
    }
    return true
  })
  if (effectiveKeys.length === 0) {
    return {
      ok: false,
      error: lockedSkipped.length
        ? `Upgrade your plan to enable: ${lockedSkipped.join(', ')}.`
        : 'Select at least one feature to apply.',
    }
  }

  const supabase = await createClient()
  const summary = await applyFeatures(supabase, guildId, template.features, auth.moderator.userId, effectiveKeys)
  if (lockedSkipped.length) {
    summary.warnings.push(`Skipped — your plan doesn't include: ${lockedSkipped.join(', ')}. Upgrade to enable them.`)
  }
  if (summary.applied.length === 0 && summary.warnings.length > 0) {
    return { ok: false, error: summary.warnings[0] }
  }

  // Bump usage on saved (non-builtin) templates.
  if (!template.builtin && input.templateId) {
    await supabase.from('server_templates').update({ usage_count: template.usageCount + 1 }).eq('id', template.id)
  }

  const onCount = summary.applied.filter((a) => a.enabled).length
  const offCount = summary.applied.length - onCount
  await recordNotification({
    guildId,
    type: 'server_settings_changed',
    severity: 'info',
    title: `Applied template "${template.name}"`,
    body: `${onCount} feature${onCount === 1 ? '' : 's'} on, ${offCount} off.`,
    link: `/dashboard/${guildId}/templates`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    // Superseded by the timeline event below, which names every feature the
    // template flipped instead of just counting them.
    timeline: false,
  })

  // Applying a template flips several modules in one action — record which,
  // so a later "why is Tickets suddenly on?" has an answer.
  await recordTimelineEvent({
    guildId,
    type: 'template_imported',
    title: `Template "${template.name}" was applied`,
    description: `${onCount} feature${onCount === 1 ? '' : 's'} switched on, ${offCount} off.`,
    source: 'dashboard',
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: template.id,
    targetName: template.name,
    newValue: Object.fromEntries(summary.applied.map((a) => [a.key, a.enabled])),
    metadata: {
      builtin: template.builtin,
      category: template.category,
      warnings: summary.warnings,
    },
    link: `/dashboard/${guildId}/templates`,
  })

  revalidate(guildId)
  return { ok: true, data: summary }
}

// ── Quick Setup (save + optionally apply) ─────────────────────────────────────

export type QuickSetupSaveInput = {
  name: string
  description: string
  category: TemplateCategory
  icon: string
  features: FeatureMap
  apply: boolean
}

export async function createQuickSetupTemplate(
  guildId: string,
  input: QuickSetupSaveInput,
): Promise<ActionResult<{ template: ServerTemplate; summary: ApplySummary | null }>> {
  const saved = await saveTemplate(guildId, {
    name: input.name,
    description: input.description,
    category: input.category,
    icon: input.icon,
    features: input.features,
  })
  if (!saved.ok) return { ok: false, error: saved.error }

  let summary: ApplySummary | null = null
  if (input.apply) {
    const res = await applyTemplate(guildId, { templateId: saved.data.id })
    summary = res.ok ? res.data : { applied: [], warnings: [res.error] }
  }

  revalidate(guildId)
  return { ok: true, data: { template: saved.data, summary } }
}
