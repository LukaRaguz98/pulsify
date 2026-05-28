import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { authorizeWorkspaceMember } from '@/lib/workspace-auth'
import { WorkspaceNotificationSettingsContent } from '@/components/workspace/WorkspaceNotificationSettingsContent'

export default async function WorkspaceNotificationSettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const auth = await authorizeWorkspaceMember(workspaceId, 'viewActivity')
  if (!auth.ok) redirect('/workspace')

  const supabase = await createClient()
  const { data } = await supabase
    .from('workspace_notification_prefs')
    .select('enabled_categories')
    .eq('workspace_id', workspaceId)
    .eq('user_id', auth.actor.userId)
    .maybeSingle()
  const enabled = (data?.enabled_categories as Record<string, boolean> | undefined) ?? {}

  return <WorkspaceNotificationSettingsContent workspaceId={workspaceId} initialEnabled={enabled} />
}
