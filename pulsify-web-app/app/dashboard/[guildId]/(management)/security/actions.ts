'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { recordNotification } from '@/lib/notifications-server'
import { readGuildEmbedInt } from '@/lib/embed-color'
import { postChannelComponents, type V2TopLevelComponent } from '@/lib/discord'
import {
  normaliseConfig,
  normaliseRules,
  normaliseLockdownTrigger,
  normaliseMitigation,
  MITIGATION_META,
  MODULE_LABELS,
  PATTERN_META,
  SEVERITY_META,
  normaliseSeverity,
  normalisePattern,
  type SecurityConfig,
  type MitigationAction,
  type SecurityModule,
  type SecurityPattern,
  type SecuritySeverity,
} from '@/lib/security'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/security`)
}

const td = (content: string) => ({ type: 10, content })

/**
 * Post a security alert to the configured channel (best-effort).
 *
 * The colour is the guild's accent (Server Settings), like every other Pulse
 * embed — the severity is already stated in the title and the footer, so it
 * doesn't need a colour to carry it.
 */
async function sendDiscordAlert(
  guildId: string,
  alertChannelId: string | null,
  opts: { title: string; lines: string[]; severity: SecuritySeverity },
): Promise<void> {
  if (!alertChannelId) return
  const supabase = await createClient()
  const container: V2TopLevelComponent = {
    type: 17,
    accent_color: await readGuildEmbedInt(supabase, guildId),
    components: [
      td('**Pulse — Security**'),
      td(`# ${opts.title}`),
      { type: 14, divider: true, spacing: 1 },
      ...opts.lines.map((l) => td(l)),
      td(`-# Pulse — DDoS Protection — ${SEVERITY_META[opts.severity].label}`),
    ],
  } as unknown as V2TopLevelComponent
  await postChannelComponents(alertChannelId, [container]).catch(() => {})
}

async function loadConfig(
  supabase: Awaited<ReturnType<typeof createClient>>,
  guildId: string,
): Promise<SecurityConfig> {
  const { data } = await supabase.from('security_configs').select('*').eq('guild_id', guildId).maybeSingle()
  return normaliseConfig(data as Record<string, unknown> | null)
}

// ── Save configuration (rules + auto-lockdown + alert channel + toggle) ────────

export async function saveSecurityConfig(
  guildId: string,
  input: {
    enabled: boolean
    alert_channel_id: string | null
    rules: SecurityConfig['rules']
    auto_lockdown: SecurityConfig['auto_lockdown']
  },
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const rules = normaliseRules(input.rules)
  const auto_lockdown = normaliseLockdownTrigger(input.auto_lockdown)
  const alert_channel_id = input.alert_channel_id?.trim() || null

  const { error } = await supabase.from('security_configs').upsert(
    {
      guild_id: guildId,
      enabled: Boolean(input.enabled),
      alert_channel_id,
      rules,
      auto_lockdown,
      updated_at: new Date().toISOString(),
      updated_by: auth.moderator.userId,
    },
    { onConflict: 'guild_id' },
  )
  if (error) return { ok: false, error: `Failed to save: ${error.message}` }

  await recordNotification({
    guildId,
    type: 'security_mitigation',
    severity: 'info',
    title: input.enabled ? 'DDoS Protection settings saved' : 'DDoS Protection disabled',
    link: `/dashboard/${guildId}/security`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
  })

  revalidate(guildId)
  return { ok: true }
}

// ── Manual mitigation (admin-triggered) ───────────────────────────────────────

export async function triggerManualMitigation(
  guildId: string,
  input: {
    action: MitigationAction
    module?: SecurityModule | null
    target_user_id?: string | null
    target_user_name?: string | null
    reason?: string | null
    /** Minutes the mitigation lasts. 0 = until lifted by hand. */
    duration_minutes: number
  },
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const action = normaliseMitigation(input.action)
  if (!action) return { ok: false, error: 'Unknown mitigation action.' }
  const meta = MITIGATION_META[action]

  if (meta.targets === 'user' && !input.target_user_id?.trim()) {
    return { ok: false, error: 'This action needs a target member ID.' }
  }
  if (meta.targets === 'module' && !input.module) {
    return { ok: false, error: 'This action needs a target module.' }
  }

  const supabase = await createClient()
  const config = await loadConfig(supabase, guildId)

  // The lockdown action is special — it flips the live lockdown state.
  if (action === 'lockdown') {
    return setLockdown(guildId, true, input.reason ?? 'Manual lockdown by an administrator.')
  }

  const expiresAt =
    input.duration_minutes > 0 ? new Date(Date.now() + input.duration_minutes * 60_000).toISOString() : null

  const { error } = await supabase.from('security_mitigations').insert({
    guild_id: guildId,
    action,
    module: meta.targets === 'module' ? input.module : null,
    target_user_id: meta.targets === 'user' ? input.target_user_id?.trim() : null,
    target_user_name: meta.targets === 'user' ? input.target_user_name?.trim() || null : null,
    reason: input.reason?.trim() || `Manual ${meta.label.toLowerCase()} by ${auth.moderator.username ?? 'an admin'}.`,
    source: 'manual',
    active: true,
    started_at: new Date().toISOString(),
    expires_at: expiresAt,
  })
  if (error) return { ok: false, error: `Failed to apply: ${error.message}` }

  const target =
    meta.targets === 'user'
      ? input.target_user_name || `<@${input.target_user_id}>`
      : meta.targets === 'module'
        ? MODULE_LABELS[input.module as SecurityModule]
        : 'server-wide'

  await recordNotification({
    guildId,
    type: 'security_mitigation',
    severity: 'warning',
    title: `Mitigation applied: ${meta.label}`,
    body: `${meta.label} (${target})${expiresAt ? ` for ${input.duration_minutes}m` : ''}.`,
    link: `/dashboard/${guildId}/security`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
    targetId: meta.targets === 'user' ? input.target_user_id ?? null : null,
  })

  await sendDiscordAlert(guildId, config.alert_channel_id, {
    title: `Mitigation applied — ${meta.label}`,
    lines: [
      `**Target:** ${target}`,
      `**Applied by:** ${auth.moderator.username ?? 'an administrator'}`,
      expiresAt ? `**Expires:** <t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:R>` : '**Duration:** until lifted',
      input.reason ? `**Reason:** ${input.reason}` : '',
    ].filter(Boolean),
    severity: 'high',
  })

  revalidate(guildId)
  return { ok: true }
}

// ── End a mitigation (recovery) ────────────────────────────────────────────────

export async function endMitigation(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { data: row } = await supabase
    .from('security_mitigations')
    .select('action')
    .eq('id', id)
    .eq('guild_id', guildId)
    .maybeSingle()

  // Lifting a lockdown mitigation must also clear the live lockdown flag.
  if (row?.action === 'lockdown') {
    return setLockdown(guildId, false, null)
  }

  const { error } = await supabase
    .from('security_mitigations')
    .update({ active: false, ended_at: new Date().toISOString(), ended_by: auth.moderator.userId })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: error.message }

  await recordNotification({
    guildId,
    type: 'security_recovered',
    severity: 'success',
    title: 'Mitigation lifted',
    link: `/dashboard/${guildId}/security`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
  })

  revalidate(guildId)
  return { ok: true }
}

// ── Lockdown (enable / disable) ────────────────────────────────────────────────

export async function setLockdown(
  guildId: string,
  on: boolean,
  reason: string | null,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const config = await loadConfig(supabase, guildId)
  const nowIso = new Date().toISOString()

  const { error } = await supabase.from('security_configs').upsert(
    {
      guild_id: guildId,
      // Lockdown is meaningful only while the module is enabled — turn it on too.
      enabled: on ? true : config.enabled,
      lockdown_active: on,
      lockdown_reason: on ? reason ?? 'Server lockdown enabled.' : null,
      lockdown_since: on ? nowIso : null,
      updated_at: nowIso,
      updated_by: auth.moderator.userId,
    },
    { onConflict: 'guild_id' },
  )
  if (error) return { ok: false, error: `Failed to update lockdown: ${error.message}` }

  if (on) {
    await supabase.from('security_mitigations').insert({
      guild_id: guildId,
      action: 'lockdown',
      source: 'lockdown',
      reason: reason ?? `Lockdown enabled by ${auth.moderator.username ?? 'an admin'}.`,
      active: true,
      started_at: nowIso,
    })
  } else {
    await supabase
      .from('security_mitigations')
      .update({ active: false, ended_at: nowIso, ended_by: auth.moderator.userId })
      .eq('guild_id', guildId)
      .eq('action', 'lockdown')
      .eq('active', true)
  }

  await recordNotification({
    guildId,
    type: on ? 'security_mitigation' : 'security_recovered',
    severity: on ? 'error' : 'success',
    title: on ? 'Server lockdown enabled' : 'Server lockdown lifted',
    body: on ? reason ?? undefined : undefined,
    link: `/dashboard/${guildId}/security`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
  })

  await sendDiscordAlert(guildId, config.alert_channel_id, {
    title: on ? 'Server lockdown ENABLED' : 'Server lockdown lifted',
    lines: [
      on
        ? 'All Pulse-driven actions are blocked until an administrator lifts the lockdown.'
        : 'Normal operation has resumed.',
      `**By:** ${auth.moderator.username ?? 'an administrator'}`,
      on && reason ? `**Reason:** ${reason}` : '',
    ].filter(Boolean),
    severity: on ? 'critical' : 'low',
  })

  revalidate(guildId)
  return { ok: true }
}

// ── Investigation: resolve events ──────────────────────────────────────────────

export async function resolveEvent(guildId: string, id: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const { error } = await supabase
    .from('security_events')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('guild_id', guildId)
  if (error) return { ok: false, error: error.message }
  revalidate(guildId)
  return { ok: true }
}

export async function resolveAllEvents(guildId: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const { error } = await supabase
    .from('security_events')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('guild_id', guildId)
    .neq('status', 'resolved')
  if (error) return { ok: false, error: error.message }
  revalidate(guildId)
  return { ok: true }
}

// ── Test detection (lets admins verify the pipeline end-to-end) ────────────────

/**
 * Raise a synthetic detection event so admins can confirm alerts + the
 * monitoring view work before a real incident. Writes a `manual`-sourced event
 * and fires the dashboard + Discord alert, but applies no mitigation.
 */
export async function simulateDetection(
  guildId: string,
  pattern: SecurityPattern,
  severity: SecuritySeverity,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const p = normalisePattern(pattern)
  const sev = normaliseSeverity(severity)
  const meta = PATTERN_META[p]
  const supabase = await createClient()
  const config = await loadConfig(supabase, guildId)

  const { error } = await supabase.from('security_events').insert({
    guild_id: guildId,
    pattern: p,
    module: meta.module,
    severity: sev,
    status: 'open',
    actor_id: meta.scope === 'user' ? auth.moderator.userId : null,
    actor_name: meta.scope === 'user' ? auth.moderator.username : null,
    count: 0,
    threshold: 0,
    window_seconds: 0,
    source: 'manual',
    details: { simulated: true },
  })
  if (error) return { ok: false, error: error.message }

  await recordNotification({
    guildId,
    type: 'security_alert',
    severity: sev === 'critical' || sev === 'high' ? 'error' : 'warning',
    title: `Test alert: ${meta.label}`,
    body: 'This is a simulated detection raised from the dashboard.',
    link: `/dashboard/${guildId}/security`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
  })

  await sendDiscordAlert(guildId, config.alert_channel_id, {
    title: `Test alert — ${meta.label}`,
    lines: ['This is a simulated detection raised from the dashboard to verify alerts.'],
    severity: sev,
  })

  revalidate(guildId)
  return { ok: true }
}
