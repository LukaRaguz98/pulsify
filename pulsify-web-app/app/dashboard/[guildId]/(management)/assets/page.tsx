import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { AssetsContent } from '@/components/dashboard/assets/AssetsContent'

export default async function AssetsPage({
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

  return <AssetsContent guildId={guildId} />
}
