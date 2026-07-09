import { redirect } from 'next/navigation'

// Private Channels moved into the Channels view as a tab. Keep this route as a
// permanent redirect so old links + bot notifications land in the right place.
export default async function PrivateChannelsPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  redirect(`/dashboard/${guildId}/channels?tab=private`)
}
