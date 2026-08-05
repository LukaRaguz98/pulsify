import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildMembers } from '@/lib/discord'
import { InvitesContent } from '@/components/dashboard/invites/InvitesContent'
import {
  normaliseInviteSettings,
  type InvitedMember,
  type InviteAdjustment,
} from '@/lib/invites'

export default async function InvitesPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const [guild, guildMembers, settingsRow, memberRows, adjustmentRows] = await Promise.all([
    fetchGuild(guildId),
    // Only for avatars — so the invited-members table shows the same faces as
    // the Members directory. Anyone missing falls back to a default avatar.
    fetchGuildMembers(guildId, 1000),
    supabase.from('invite_settings').select('*').eq('guild_id', guildId).maybeSingle(),
    supabase.from('invited_members').select('*').eq('guild_id', guildId).order('joined_at', { ascending: false }).limit(2000),
    supabase.from('invite_adjustments').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(500),
  ])

  const config = normaliseInviteSettings(settingsRow.data as { enabled?: boolean; settings?: unknown } | null)
  const members: InvitedMember[] = (memberRows.data ?? []).map((m) => normaliseMemberRow(m as Record<string, unknown>))
  const adjustments: InviteAdjustment[] = (adjustmentRows.data ?? []).map((a) => ({
    id: String(a.id),
    guild_id: String(a.guild_id),
    user_id: (a.user_id as string | null) ?? null,
    user_name: (a.user_name as string | null) ?? null,
    kind: (a.kind as InviteAdjustment['kind']) ?? 'bonus',
    amount: Number(a.amount ?? 0),
    target_user_id: (a.target_user_id as string | null) ?? null,
    target_name: (a.target_name as string | null) ?? null,
    reason: (a.reason as string | null) ?? null,
    created_by: (a.created_by as string | null) ?? null,
    created_by_name: (a.created_by_name as string | null) ?? null,
    created_at: String(a.created_at),
  }))

  // Keep the avatar payload tight: only users the tables actually render, and
  // only when Discord gave us a real hash (no hash → default avatar anyway).
  const referenced = new Set<string>()
  for (const m of members) {
    referenced.add(m.user_id)
    if (m.inviter_id) referenced.add(m.inviter_id)
  }
  const avatars: Record<string, string> = {}
  for (const gm of guildMembers) {
    const id = gm.user?.id
    if (id && gm.user.avatar && referenced.has(id)) avatars[id] = gm.user.avatar
  }

  return (
    <InvitesContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      config={config}
      members={members}
      adjustments={adjustments}
      avatars={avatars}
    />
  )
}

function normaliseMemberRow(m: Record<string, unknown>): InvitedMember {
  return {
    id: String(m.id ?? ''),
    guild_id: String(m.guild_id ?? ''),
    user_id: String(m.user_id ?? ''),
    user_name: (m.user_name as string | null) ?? null,
    inviter_id: (m.inviter_id as string | null) ?? null,
    inviter_name: (m.inviter_name as string | null) ?? null,
    invite_code: (m.invite_code as string | null) ?? null,
    source: (m.source as InvitedMember['source']) ?? 'unknown',
    account_created_at: (m.account_created_at as string | null) ?? null,
    joined_at: String(m.joined_at ?? ''),
    left_at: (m.left_at as string | null) ?? null,
    status: (m.status as InvitedMember['status']) ?? 'pending',
    fake_reason: (m.fake_reason as string | null) ?? null,
    is_alt: Boolean(m.is_alt),
    completed_onboarding: Boolean(m.completed_onboarding),
    verified: Boolean(m.verified),
    is_active: Boolean(m.is_active),
    rejoin_count: Number(m.rejoin_count ?? 0),
    is_bonus: Boolean(m.is_bonus),
    metadata: (m.metadata as Record<string, unknown>) ?? {},
    created_at: String(m.created_at ?? ''),
    updated_at: String(m.updated_at ?? ''),
  }
}
