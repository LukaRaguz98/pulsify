import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { PageHeader } from '@/components/ui/page-header'
import { PulseAssistantTab } from '@/components/dashboard/Pulse/PulseAssistantTab'

// Pulse's content-generation settings (what it knows about the server, tone,
// language, embed colour) live here — reached from the "Pulse assistant" button
// on the Automations view. These are automation-adjacent settings, so they
// belong with Automations rather than in a standalone Pulse page. Sibling path
// so the Automations nav item stays highlighted (prefix-matches /automations).
export default async function AutomationsSettingsPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/')

  return (
    <div className="page-content max-w-4xl">
      <PageHeader
        title="Pulse assistant"
        description="Configure what Pulse knows about your server when generating content, and how its output looks."
        action={
          <Link
            href={`/dashboard/${guildId}/automations`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <ArrowLeft size={12} />
            Back to Automations
          </Link>
        }
      />
      <PulseAssistantTab guildId={guildId} />
    </div>
  )
}
