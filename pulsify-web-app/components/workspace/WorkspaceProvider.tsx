'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase'
import {
  can as canFor,
  type Capability,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceRole,
  type WorkspaceServer,
} from '@/lib/workspace'

type WorkspaceContextValue = {
  workspace: Workspace
  role: WorkspaceRole
  meId: string
  members: WorkspaceMember[]
  servers: WorkspaceServer[]
  can: (capability: Capability) => boolean
  isOwner: boolean
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({
  workspace,
  role,
  meId,
  members: initialMembers,
  servers: initialServers,
  children,
}: {
  workspace: Workspace
  role: WorkspaceRole
  meId: string
  members: WorkspaceMember[]
  servers: WorkspaceServer[]
  children: React.ReactNode
}) {
  const [members, setMembers] = useState(initialMembers)
  const [servers, setServers] = useState(initialServers)
  const supabase = useMemo(() => createClient(), [])

  // Keep the roster + server list fresh so the sidebar counts, mention
  // autocomplete and assignee pickers reflect live team changes.
  useEffect(() => {
    const reload = async () => {
      const [{ data: m }, { data: s }] = await Promise.all([
        supabase.from('workspace_members').select('*').eq('workspace_id', workspace.id).order('joined_at', { ascending: true }),
        supabase.from('workspace_servers').select('*').eq('workspace_id', workspace.id).order('created_at', { ascending: true }),
      ])
      if (m) setMembers(m as WorkspaceMember[])
      if (s) setServers(s as WorkspaceServer[])
    }
    const channel: RealtimeChannel = supabase
      .channel(`workspace:${workspace.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_members', filter: `workspace_id=eq.${workspace.id}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_servers', filter: `workspace_id=eq.${workspace.id}` }, reload)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, workspace.id])

  const value: WorkspaceContextValue = {
    workspace,
    role,
    meId,
    members,
    servers,
    can: (c) => canFor(role, c),
    isOwner: workspace.owner_id === meId,
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  return ctx
}
