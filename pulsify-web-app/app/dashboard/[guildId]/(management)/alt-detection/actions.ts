'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import {
  INVESTIGATION_STATUSES,
  STATUS_META,
  orderPair,
  type AltRiskLevel,
  type InvestigationStatus,
  type LinkIndicator,
} from '@/lib/alt-detection'

// Server actions for Alt Risk Detection (PULSIFY-59).
//
// The score is never written from here — it's recomputed on every read. What
// these actions persist is the HUMAN layer: which accounts a moderator is
// investigating, what they concluded, the notes they left, and the links they
// asserted. Every one of them also appends to the investigation timeline, so a
// case can always be read back as a sequence of decisions rather than a set of
// current values.

export type ActionResult = { ok: true } | { ok: false; error: string }

const MAX_NOTE = 2000
const MAX_RESOLUTION = 500

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/alt-detection`)
}

/** Append one row to the investigation timeline. Never throws — a failed
 *  timeline write must not fail the action the moderator actually took. */
async function recordEvent(
  guildId: string,
  userId: string,
  kind: 'note' | 'status' | 'flag' | 'link' | 'unlink',
  body: string | null,
  metadata: Record<string, unknown>,
  author: { id: string; name: string | null },
) {
  const supabase = await createClient()
  await supabase
    .from('alt_investigation_events')
    .insert({
      guild_id: guildId,
      user_id: userId,
      kind,
      body,
      metadata,
      author_id: author.id,
      author_name: author.name,
    })
    .then(
      () => undefined,
      () => undefined,
    )
}

/**
 * Open (or refresh) an investigation for an account. Idempotent per member: a
 * second call on an existing case updates the score snapshot without reopening
 * a resolved one, so re-checking a cleared account doesn't resurrect it.
 */
export async function openInvestigation(
  guildId: string,
  account: { userId: string; userName: string | null },
  risk: { score: number; level: AltRiskLevel; signals: string[] },
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('alt_investigations')
    .select('id, status')
    .eq('guild_id', guildId)
    .eq('user_id', account.userId)
    .maybeSingle()

  const snapshot = {
    risk_score: Math.max(0, Math.min(100, Math.round(risk.score))),
    risk_level: risk.level,
    signals: risk.signals,
    user_name: account.userName,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { error } = await supabase.from('alt_investigations').update(snapshot).eq('id', existing.id)
    if (error) return { ok: false, error: error.message }
    revalidate(guildId)
    return { ok: true }
  }

  const { error } = await supabase.from('alt_investigations').insert({
    guild_id: guildId,
    user_id: account.userId,
    status: 'open',
    source: 'dashboard',
    opened_by: auth.moderator.userId,
    opened_by_name: auth.moderator.username,
    ...snapshot,
  })
  if (error) return { ok: false, error: error.message }

  await recordEvent(
    guildId,
    account.userId,
    'flag',
    `Investigation opened at ${snapshot.risk_score}/100 (${risk.level}).`,
    { score: snapshot.risk_score, level: risk.level, signals: risk.signals },
    { id: auth.moderator.userId, name: auth.moderator.username },
  )

  revalidate(guildId)
  return { ok: true }
}

/**
 * Move a case along: open → monitoring → cleared / confirmed / banned. Closing a
 * case (any resolved status) stamps who closed it and why; reopening clears that
 * stamp so the case doesn't look resolved while it sits in the queue.
 */
export async function setInvestigationStatus(
  guildId: string,
  userId: string,
  status: InvestigationStatus,
  resolution?: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  if (!INVESTIGATION_STATUSES.includes(status)) return { ok: false, error: 'Unknown investigation status.' }

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('alt_investigations')
    .select('id, status')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!existing) return { ok: false, error: 'There is no investigation open for this account.' }
  if (existing.status === status) return { ok: true }

  const resolved = STATUS_META[status].resolved
  const trimmed = resolution?.trim().slice(0, MAX_RESOLUTION) || null

  const { error } = await supabase
    .from('alt_investigations')
    .update({
      status,
      resolution: resolved ? trimmed : null,
      resolved_at: resolved ? new Date().toISOString() : null,
      resolved_by: resolved ? auth.moderator.userId : null,
      resolved_by_name: resolved ? auth.moderator.username : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
  if (error) return { ok: false, error: error.message }

  await recordEvent(
    guildId,
    userId,
    'status',
    trimmed
      ? `${STATUS_META[existing.status as InvestigationStatus]?.label ?? existing.status} → ${STATUS_META[status].label}: ${trimmed}`
      : `${STATUS_META[existing.status as InvestigationStatus]?.label ?? existing.status} → ${STATUS_META[status].label}`,
    { from: existing.status, to: status, resolution: trimmed },
    { id: auth.moderator.userId, name: auth.moderator.username },
  )

  revalidate(guildId)
  return { ok: true }
}

/**
 * Add a moderator note to an account. Notes stand on their own — you can leave
 * one on an account with no open case (it lands on the timeline either way), but
 * if there IS a case, the note bumps its updated_at so the queue re-sorts.
 */
export async function addInvestigationNote(
  guildId: string,
  userId: string,
  body: string,
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const trimmed = body.trim()
  if (!trimmed) return { ok: false, error: 'Write something before saving the note.' }

  const supabase = await createClient()
  const { error } = await supabase.from('alt_investigation_events').insert({
    guild_id: guildId,
    user_id: userId,
    kind: 'note',
    body: trimmed.slice(0, MAX_NOTE),
    author_id: auth.moderator.userId,
    author_name: auth.moderator.username,
  })
  if (error) return { ok: false, error: error.message }

  await supabase
    .from('alt_investigations')
    .update({ updated_at: new Date().toISOString() })
    .eq('guild_id', guildId)
    .eq('user_id', userId)

  revalidate(guildId)
  return { ok: true }
}

/**
 * Assert that two accounts are related. This is the one link the product treats
 * as authoritative — everything else the UI shows is a computed *potential*
 * link. Stored on the normalised pair so the same two accounts can't be linked
 * twice with the ids swapped.
 */
export async function linkAccounts(
  guildId: string,
  a: { userId: string; userName: string | null },
  b: { userId: string; userName: string | null },
  opts: { confidence?: number; note?: string; indicators?: LinkIndicator[] } = {},
): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  if (a.userId === b.userId) return { ok: false, error: "An account can't be linked to itself." }
  if (!/^\d{15,25}$/.test(b.userId)) return { ok: false, error: 'That does not look like a Discord user ID.' }

  const [firstId, secondId] = orderPair(a.userId, b.userId)
  const first = firstId === a.userId ? a : b
  const second = secondId === a.userId ? a : b

  const supabase = await createClient()
  const { error } = await supabase.from('alt_account_links').insert({
    guild_id: guildId,
    user_id: first.userId,
    user_name: first.userName,
    linked_user_id: second.userId,
    linked_user_name: second.userName,
    confidence: Math.max(0, Math.min(100, Math.round(opts.confidence ?? 100))),
    indicators: opts.indicators ?? [],
    note: opts.note?.trim().slice(0, MAX_NOTE) || null,
    created_by: auth.moderator.userId,
    created_by_name: auth.moderator.username,
  })
  if (error) {
    // 23505 = the unique index on (guild, pair) — already linked.
    if (error.code === '23505') return { ok: false, error: 'These accounts are already linked.' }
    return { ok: false, error: error.message }
  }

  // The link belongs to both accounts, so it lands on both timelines.
  const author = { id: auth.moderator.userId, name: auth.moderator.username }
  await recordEvent(
    guildId,
    a.userId,
    'link',
    `Linked to ${b.userName ?? b.userId}.`,
    { linked_user_id: b.userId, note: opts.note ?? null },
    author,
  )
  await recordEvent(
    guildId,
    b.userId,
    'link',
    `Linked to ${a.userName ?? a.userId}.`,
    { linked_user_id: a.userId, note: opts.note ?? null },
    author,
  )

  revalidate(guildId)
  return { ok: true }
}

/** Remove a moderator-asserted link (a mistake, or a cleared investigation). */
export async function unlinkAccounts(guildId: string, linkId: string): Promise<ActionResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { data: link } = await supabase
    .from('alt_account_links')
    .select('*')
    .eq('guild_id', guildId)
    .eq('id', linkId)
    .maybeSingle()
  if (!link) return { ok: false, error: 'That link no longer exists.' }

  const { error } = await supabase.from('alt_account_links').delete().eq('id', linkId).eq('guild_id', guildId)
  if (error) return { ok: false, error: error.message }

  const author = { id: auth.moderator.userId, name: auth.moderator.username }
  await recordEvent(
    guildId,
    link.user_id,
    'unlink',
    `Link to ${link.linked_user_name ?? link.linked_user_id} removed.`,
    { linked_user_id: link.linked_user_id },
    author,
  )
  await recordEvent(
    guildId,
    link.linked_user_id,
    'unlink',
    `Link to ${link.user_name ?? link.user_id} removed.`,
    { linked_user_id: link.user_id },
    author,
  )

  revalidate(guildId)
  return { ok: true }
}
