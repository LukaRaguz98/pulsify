import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { ROLE_LABELS, isInviteUsable, isWorkspaceRole, type WorkspaceRole } from '@/lib/workspace'
import { JoinWorkspace } from '@/components/workspace/JoinWorkspace'

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const supabase = await createClient()

  const { data: invite } = await supabase
    .from('workspace_invites')
    .select('id, workspace_id, role, revoked, expires_at, max_uses, uses')
    .eq('code', code)
    .maybeSingle()

  let workspaceName: string | null = null
  let logoUrl: string | null = null
  if (invite) {
    const { data: ws } = await supabase.from('workspaces').select('name, logo_url').eq('id', invite.workspace_id).maybeSingle()
    workspaceName = ws?.name ?? null
    logoUrl = ws?.logo_url ?? null
  }

  const usable = invite ? isInviteUsable(invite) : false
  const role: WorkspaceRole = invite && isWorkspaceRole(invite.role) ? invite.role : 'support'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <Link href="/workspace" className="mb-8 flex items-center gap-2.5">
        <Image src="/logo.png" alt="Pulsify" width={32} height={32} style={{ filter: 'drop-shadow(0 4px 10px var(--p-glow))' }} />
        <span className="font-bold text-lg tracking-tight" style={{ color: 'var(--p-1)' }}>Pulsify</span>
      </Link>

      <div className="w-full max-w-md rounded-2xl border p-8 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        {!invite || !usable || !workspaceName ? (
          <>
            <p className="text-lg font-semibold text-foreground">Invite unavailable</p>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-3)' }}>
              This invite link is invalid, expired, or has already been used up.
            </p>
            <Link href="/workspace" className="mt-6 inline-block rounded-lg border px-4 py-2 text-sm font-medium text-foreground transition" style={{ borderColor: 'var(--line-strong)' }}>
              Go to workspaces
            </Link>
          </>
        ) : (
          <>
            {logoUrl ? (
              <Image src={logoUrl} alt={workspaceName} width={56} height={56} className="mx-auto h-14 w-14 rounded-2xl object-cover" unoptimized />
            ) : (
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
                {workspaceName.charAt(0).toUpperCase()}
              </div>
            )}
            <p className="mt-4 text-sm" style={{ color: 'var(--text-3)' }}>You&apos;ve been invited to join</p>
            <p className="mt-1 text-xl font-bold text-foreground">{workspaceName}</p>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-2)' }}>
              as <span className="font-semibold" style={{ color: 'var(--p-1)' }}>{ROLE_LABELS[role]}</span>
            </p>
            <JoinWorkspace code={code} />
          </>
        )}
      </div>
    </div>
  )
}
