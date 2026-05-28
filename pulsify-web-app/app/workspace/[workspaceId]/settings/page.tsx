import { redirect } from 'next/navigation'

// Workspace settings (branding / ownership / danger zone) are now embedded
// directly into the Overview page. Existing in-app links and bookmarks land
// here and get bounced to the new location.
export default async function WorkspaceSettingsRedirect({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  redirect(`/workspace/${workspaceId}`)
}
