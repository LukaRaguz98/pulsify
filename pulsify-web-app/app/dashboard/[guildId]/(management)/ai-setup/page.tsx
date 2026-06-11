import { redirect } from 'next/navigation'

export default async function AISetupPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  redirect(`/dashboard/${guildId}/settings`)
}
