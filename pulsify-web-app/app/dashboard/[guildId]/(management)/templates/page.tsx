import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild } from '@/lib/discord'
import { TemplatesContent } from '@/components/dashboard/templates/TemplatesContent'
import { readCurrentFeatures } from '@/app/dashboard/[guildId]/(management)/templates/actions'
import { normaliseTemplate, type FeatureMap, type ServerTemplate } from '@/lib/templates'

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

  const [guild, currentFeatures, { data: templateRows }] = await Promise.all([
    fetchGuild(guildId),
    readCurrentFeatures(guildId),
    supabase
      .from('server_templates')
      .select('*')
      .or(`author_id.eq.${authorId},guild_id.eq.${guildId}`)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const saved: ServerTemplate[] = (templateRows ?? []).map((r) => normaliseTemplate(r as Record<string, unknown>))

  return (
    <TemplatesContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      savedTemplates={saved}
      currentFeatures={currentFeatures as FeatureMap}
    />
  )
}
