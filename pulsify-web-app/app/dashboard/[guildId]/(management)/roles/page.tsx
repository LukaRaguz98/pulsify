import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { RolesContent } from '@/components/dashboard/RolesContent'

export default async function RolesPage({
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

  return <RolesContent guildId={guildId} />
}
