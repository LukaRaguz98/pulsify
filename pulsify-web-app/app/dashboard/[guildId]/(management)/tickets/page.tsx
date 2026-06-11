import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild } from '@/lib/discord'
import { TicketsContent } from '@/components/dashboard/tickets/TicketsContent'
import { normaliseConfig, normaliseStatus, normalisePriority, type Ticket } from '@/lib/tickets'
import { normaliseApplication, type Application } from '@/lib/applications'

export default async function TicketsPage({
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

  const [guild, { data: configRow }, { data: ticketRows }, { data: applicationRows }] = await Promise.all([
    fetchGuild(guildId),
    supabase.from('ticket_configs').select('*').eq('guild_id', guildId).maybeSingle(),
    // Most-recent first; capped so very busy servers stay snappy. Analytics +
    // the list both derive from this set.
    supabase
      .from('tickets')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(500),
    // Applications (channel-less submissions) reviewed under the Applications tab.
    supabase
      .from('ticket_applications')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  const config = normaliseConfig(guildId, configRow as Record<string, unknown> | null)

  const tickets: Ticket[] = (ticketRows ?? []).map((r) => ({
    id: r.id,
    guild_id: r.guild_id,
    number: r.number,
    channel_id: r.channel_id ?? null,
    type_id: r.type_id ?? null,
    type_label: r.type_label ?? null,
    subject: r.subject ?? null,
    status: normaliseStatus(r.status),
    priority: normalisePriority(r.priority),
    opener_id: r.opener_id,
    opener_name: r.opener_name ?? null,
    claimed_by: r.claimed_by ?? null,
    claimed_by_name: r.claimed_by_name ?? null,
    participants: Array.isArray(r.participants) ? r.participants : [],
    form_answers: Array.isArray(r.form_answers) ? r.form_answers : [],
    opened_at: r.opened_at,
    last_activity_at: r.last_activity_at,
    closed_at: r.closed_at ?? null,
    closed_by: r.closed_by ?? null,
    closed_by_name: r.closed_by_name ?? null,
    close_reason: r.close_reason ?? null,
    has_transcript: Boolean(r.transcript && String(r.transcript).length > 0),
  }))

  const applications: Application[] = (applicationRows ?? []).map((r) =>
    normaliseApplication(r as Record<string, unknown>),
  )

  return (
    <TicketsContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      config={config}
      initialTickets={tickets}
      initialApplications={applications}
    />
  )
}
