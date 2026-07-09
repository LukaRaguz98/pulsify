'use server'

import { createClient } from '@/lib/supabase-server'
import { isBotInGuild, checkBotPermissions } from '@/lib/discord'
import { recordNotification } from '@/lib/notifications-server'
import {
  type FeatureKey,
  type ModSensitivity,
  type OnboardingSelections,
  type OnboardingState,
  type MemberOnboardingConfig,
  normalizeMemberOnboarding,
} from '@/lib/onboarding'

type Result = { ok: true } | { ok: false; error: string }

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

async function readSettings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle()
  return (data?.settings as Record<string, unknown>) ?? {}
}

async function writeOnboardingState(
  guildId: string,
  patch: Partial<OnboardingState>,
): Promise<Result> {
  const { supabase, user } = await requireUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const current = await readSettings(supabase, guildId)
  const prevState = (current.onboarding_state as OnboardingState | undefined) ?? {
    status: 'in_progress',
    step: 0,
    selections: {},
    appliedFeatures: [],
  }
  const nextState: OnboardingState = {
    ...prevState,
    ...patch,
    selections: { ...prevState.selections, ...(patch.selections ?? {}) },
    startedAt: prevState.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('guild_settings')
    .upsert(
      { guild_id: guildId, settings: { ...current, onboarding_state: nextState }, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Persist wizard progress (step + selections) so the flow can be resumed. */
export async function saveOnboardingProgress(
  guildId: string,
  step: number,
  selections: OnboardingSelections,
): Promise<Result> {
  return writeOnboardingState(guildId, { status: 'in_progress', step, selections })
}

/** Mark the flow skipped — no banner shown after this. */
export async function skipOnboarding(guildId: string): Promise<Result> {
  return writeOnboardingState(guildId, { status: 'skipped' })
}

/**
 * Clear onboarding state entirely so the flow can be run again from scratch —
 * the first-run banner reappears and the wizard starts at step one. Applied
 * feature config (welcome, auto-role, etc.) is left untouched.
 */
export async function resetOnboarding(guildId: string): Promise<Result> {
  const { supabase, user } = await requireUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const current = await readSettings(supabase, guildId)
  if (!('onboarding_state' in current)) return { ok: true }
  const next = { ...current }
  delete next.onboarding_state

  const { error } = await supabase
    .from('guild_settings')
    .upsert(
      { guild_id: guildId, settings: next, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── Apply the selected feature templates ────────────────────────────────────

export type OnboardingSetup = {
  selections: OnboardingSelections
  welcome?: { channel_id: string; message: string }
  auto_role?: { role_id: string }
  moderation?: { channel_id: string }
  pulse_guard?: { sensitivity: ModSensitivity }
  analytics?: boolean
}

export type ApplyOutcome = {
  ok: true
  applied: FeatureKey[]
  warnings: string[]
}

/**
 * Apply the chosen quick-setup templates and mark onboarding complete.
 *
 * Writes welcome / auto-role / moderation-alert config into guild_settings and
 * Pulse Guard into ai_moderation_settings — the same shapes the dedicated pages
 * use, so everything shows up correctly there afterwards. Permission gaps become
 * non-blocking warnings (Discord enforces at runtime); a hard failure only
 * occurs if the bot isn't in the server at all.
 */
export async function applyOnboardingSetup(
  guildId: string,
  setup: OnboardingSetup,
): Promise<ApplyOutcome | { ok: false; error: string }> {
  const { supabase, user } = await requireUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  if (!(await isBotInGuild(guildId)))
    return { ok: false, error: 'The Pulse bot is not in this server. Add it first, then finish setup.' }

  const perms = await checkBotPermissions(guildId)
  const can = (k: 'sendMessages' | 'manageRoles') =>
    perms === null || perms.administrator || perms[k]

  const warnings: string[] = []
  const applied: FeatureKey[] = []

  // ── guild_settings (welcome / auto_role / moderation_alerts) ──────────────
  const current = await readSettings(supabase, guildId)
  const merged: Record<string, unknown> = { ...current }

  if (setup.welcome && setup.welcome.channel_id && setup.welcome.message.trim()) {
    merged.welcome = {
      ...(current.welcome as Record<string, unknown> ?? {}),
      enabled: true,
      channel_id: setup.welcome.channel_id,
      message: setup.welcome.message.trim(),
      type: 'message',
    }
    applied.push('welcome')
    if (!can('sendMessages')) warnings.push('Welcome messages need the bot’s “Send Messages” permission.')
  }

  if (setup.auto_role && setup.auto_role.role_id) {
    merged.auto_role = { enabled: true, role_id: setup.auto_role.role_id }
    applied.push('auto_role')
    if (!can('manageRoles')) warnings.push('Auto roles need the bot’s “Manage Roles” permission.')
  }

  if (setup.moderation && setup.moderation.channel_id) {
    merged.moderation_alerts = { enabled: true, channel_id: setup.moderation.channel_id }
    applied.push('moderation')
    if (!can('sendMessages')) warnings.push('Moderation alerts need the bot’s “Send Messages” permission.')
  }

  // ── ai_moderation_settings (Pulse Guard) ──────────────────────────────────
  if (setup.pulse_guard) {
    const { error: aiError } = await supabase.from('ai_moderation_settings').upsert(
      {
        guild_id: guildId,
        enabled: true,
        sensitivity: setup.pulse_guard.sensitivity,
        updated_at: new Date().toISOString(),
        updated_by: user.user_metadata?.provider_id ?? user.id,
      },
      { onConflict: 'guild_id' },
    )
    if (aiError) warnings.push(`Pulse Guard could not be enabled: ${aiError.message}`)
    else applied.push('pulse_guard')
  }

  if (setup.analytics) applied.push('analytics')

  // Persist guild_settings (config + completed onboarding state) in one write.
  const completedState: OnboardingState = {
    status: 'completed',
    step: 3,
    selections: setup.selections,
    appliedFeatures: applied,
    startedAt: (current.onboarding_state as OnboardingState | undefined)?.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  }
  merged.onboarding_state = completedState

  const { error } = await supabase
    .from('guild_settings')
    .upsert(
      { guild_id: guildId, settings: merged, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )
  if (error) return { ok: false, error: `Failed to save setup: ${error.message}` }

  const claims = user.user_metadata?.custom_claims as { global_name?: string; username?: string } | undefined
  await recordNotification({
    guildId,
    type: 'automation_saved',
    title: 'Setup complete',
    body: applied.length > 0 ? `Enabled: ${applied.map(featureLabel).join(', ')}` : 'Onboarding finished.',
    link: `/dashboard/${guildId}`,
    actorId: user.user_metadata?.provider_id ?? user.id,
    actorName: claims?.global_name ?? claims?.username ?? user.user_metadata?.full_name ?? null,
    actorUsername: claims?.username ?? null,
  })

  return { ok: true, applied, warnings }
}

// ── Member-facing Onboarding & Welcome (PULSIFY-37) ─────────────────────────

/**
 * Persist the member onboarding & welcome configuration into
 * guild_settings.settings.member_onboarding. The bot reads the same shape to
 * deliver the interactive panel to new members. Validation is light — the editor
 * already constrains shapes; we normalize and clean obviously-empty entries.
 */
export async function saveMemberOnboarding(
  guildId: string,
  config: MemberOnboardingConfig,
): Promise<Result> {
  const { supabase, user } = await requireUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const clean = normalizeMemberOnboarding(config)

  // Drop empty role categories / roles and empty quick-links/buttons so the
  // panel never renders blank controls.
  clean.roleCategories = clean.roleCategories
    .map((c) => ({ ...c, roles: c.roles.filter((r) => r.role_id) }))
    .filter((c) => c.roles.length > 0)
  clean.welcome.buttons = clean.welcome.buttons.filter((b) => b.label.trim() && b.url.trim())
  clean.welcome.quick_links = clean.welcome.quick_links.filter((q) => q.label.trim() && q.channel_id)

  if (clean.enabled && clean.delivery === 'channel' && !clean.channel_id)
    return { ok: false, error: 'Pick a channel to post onboarding to, or switch delivery to DM.' }
  if (clean.enabled && clean.verification.enabled && !clean.verification.role_id)
    return { ok: false, error: 'Verification is on but no verified role is selected.' }

  const current = await readSettings(supabase, guildId)
  const { error } = await supabase
    .from('guild_settings')
    .upsert(
      {
        guild_id: guildId,
        settings: { ...current, member_onboarding: clean },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'guild_id' },
    )
  if (error) return { ok: false, error: error.message }

  const claims = user.user_metadata?.custom_claims as { global_name?: string; username?: string } | undefined
  await recordNotification({
    guildId,
    type: 'automation_saved',
    title: 'Onboarding updated',
    body: clean.enabled ? 'Member onboarding is live.' : 'Member onboarding saved (disabled).',
    link: `/dashboard/${guildId}/onboarding`,
    actorId: user.user_metadata?.provider_id ?? user.id,
    actorName: claims?.global_name ?? claims?.username ?? user.user_metadata?.full_name ?? null,
    actorUsername: claims?.username ?? null,
  }).catch(() => {})

  return { ok: true }
}

// ── Member messages (welcome / goodbye greetings + server rules) ────────────
// Moved here from the old Automations view (which was removed). Merge-based:
// each call writes only the slices it provides, preserving the rest of
// guild_settings. The Pulse bot reads guild_settings.welcome / .goodbye / .rules
// exactly as before.

type EmbedConfig = {
  color: string
  title: string
  description: string
  fields: { name: string; value: string; inline: boolean }[]
  footer_text: string
  banner_color: string
}

export type MemberEventConfig = {
  enabled:    boolean
  channel_id: string
  message:    string
  type?:      'message' | 'embed'
  embed?:     EmbedConfig
}

export type PulseRulesConfig = { enabled: boolean; channel_id: string; title: string; content: string }

export type MemberMessages = {
  welcome?: MemberEventConfig
  goodbye?: MemberEventConfig
  rules?:   PulseRulesConfig
}

export async function saveMemberMessages(
  guildId: string,
  messages: MemberMessages,
): Promise<Result> {
  const { supabase, user } = await requireUser()
  if (!user) return { ok: false, error: 'Unauthorized.' }

  const { welcome, goodbye, rules } = messages

  if (welcome) {
    if (welcome.enabled && !welcome.channel_id)
      return { ok: false, error: 'Welcome Message: please select a channel.' }
    if (welcome.enabled && welcome.type !== 'embed' && !welcome.message.trim())
      return { ok: false, error: 'Welcome Message: message text cannot be empty.' }
  }
  if (goodbye) {
    if (goodbye.enabled && !goodbye.channel_id)
      return { ok: false, error: 'Goodbye Message: please select a channel.' }
    if (goodbye.enabled && goodbye.type !== 'embed' && !goodbye.message.trim())
      return { ok: false, error: 'Goodbye Message: message text cannot be empty.' }
  }

  if (!(await isBotInGuild(guildId)))
    return { ok: false, error: 'The Pulse bot is not installed in this server. Add it first.' }

  if (welcome?.enabled || goodbye?.enabled) {
    const perms = await checkBotPermissions(guildId)
    if (perms !== null) {
      if (!perms.inGuild)
        return { ok: false, error: 'Could not verify bot permissions. Is the bot still in the server?' }
      if (!perms.administrator && !perms.sendMessages)
        return { ok: false, error: 'Welcome / Goodbye messages require the bot to have the Send Messages permission.' }
    }
  }

  const current = await readSettings(supabase, guildId)
  const merged = {
    ...current,
    ...(welcome !== undefined ? { welcome } : {}),
    ...(goodbye !== undefined ? { goodbye } : {}),
    ...(rules   !== undefined ? { rules } : {}),
  }

  const { error } = await supabase
    .from('guild_settings')
    .upsert(
      { guild_id: guildId, settings: merged, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )
  if (error) return { ok: false, error: `Failed to save: ${error.message}` }

  const claims = user.user_metadata?.custom_claims as { global_name?: string; username?: string } | undefined
  const enabled: string[] = []
  if (welcome?.enabled) enabled.push('Welcome')
  if (goodbye?.enabled) enabled.push('Goodbye')
  if (rules?.enabled) enabled.push('Server Rules')
  await recordNotification({
    guildId,
    type: 'automation_saved',
    title: 'Member messages saved',
    body: enabled.length > 0 ? `Active: ${enabled.join(', ')}` : 'No member messages are currently enabled.',
    link: `/dashboard/${guildId}/onboarding`,
    actorId: user.user_metadata?.provider_id ?? user.id,
    actorName: claims?.global_name ?? claims?.username ?? user.user_metadata?.full_name ?? null,
    actorUsername: claims?.username ?? null,
  }).catch(() => {})

  return { ok: true }
}

function featureLabel(key: FeatureKey): string {
  return {
    welcome: 'Welcome',
    auto_role: 'Auto roles',
    moderation: 'Moderation alerts',
    pulse_guard: 'Pulse Guard',
    analytics: 'Analytics',
  }[key]
}
