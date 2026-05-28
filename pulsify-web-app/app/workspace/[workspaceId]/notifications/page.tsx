import { authorizeWorkspaceMember } from '@/lib/workspace-auth'
import { redirect } from 'next/navigation'
import { WorkspaceNotificationsContent } from '@/components/workspace/WorkspaceNotificationsContent'

export default async function WorkspaceNotificationsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const auth = await authorizeWorkspaceMember(workspaceId, 'viewActivity')
  if (!auth.ok) redirect('/workspace')

  return <WorkspaceNotificationsContent workspaceId={workspaceId} />
}
