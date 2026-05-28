import { createClient } from '@/lib/supabase-server'
import { TasksContent } from '@/components/workspace/TasksContent'
import type { WorkspaceTask } from '@/lib/workspace'

export default async function WorkspaceTasksPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('workspace_tasks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  return <TasksContent initialTasks={(data ?? []) as WorkspaceTask[]} />
}
