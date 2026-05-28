import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'

// Signed-in gate for the billing / subscription management area. Mirrors
// app/workspace/layout.tsx (and app/dashboard/layout.tsx) — billing is a
// user-scoped page (not per-guild), so the only gate is "are you signed in".
export default async function BillingLayout({
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
