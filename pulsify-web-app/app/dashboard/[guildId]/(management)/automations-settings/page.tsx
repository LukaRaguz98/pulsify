import { redirect } from 'next/navigation'

// The Pulse Assistant settings (server context, writing style, embed colour)
// moved into Server Settings. Keep this route as a permanent redirect so old
// links and bookmarks land in the right place.
export default async function AutomationsSettingsPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  redirect(`/dashboard/${guildId}/server-settings`)
}
