import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'

// Signed-in gate for the whole workspace area. Mirrors app/dashboard/layout.tsx.
// Per-workspace membership is enforced one level down in [workspaceId]/layout.
export default async function WorkspaceAreaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/')

  return <div className="min-h-screen bg-background text-foreground">{children}</div>
}
