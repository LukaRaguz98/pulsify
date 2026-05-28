import { redirect } from 'next/navigation'

// /activity is the legacy route for what is now /notifications — the bell
// dropdown, the workspace sidebar entry and the command palette all point at
// /notifications. Existing bookmarks and outbound links land here and get
// bounced to the new location.
export default async function WorkspaceActivityRedirect({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  redirect(`/workspace/${workspaceId}/notifications`)
}
