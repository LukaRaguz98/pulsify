import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { MemberProfile } from '@/components/dashboard/members/MemberProfile'

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ guildId: string; userId: string }>
}) {
  const { guildId, userId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/')

  return <MemberProfile guildId={guildId} userId={userId} />
}
