import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { ModerationContent } from '@/components/dashboard/ModerationContent'

export default async function ModerationPage({
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

  return <ModerationContent guildId={guildId} />
}
