'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'

/**
 * Subscribe to a workspace-scoped table and keep a live list of its rows.
 * Seeds with the server-rendered `initial` snapshot, then refetches on any
 * INSERT/UPDATE/DELETE for this workspace so the collaboration surfaces (notes,
 * tasks, incidents) update as teammates work — same realtime pattern as the
 * notifications provider, generalised.
 */
export function useRealtimeRows<T>(
  table: string,
  workspaceId: string,
  initial: T[],
  orderBy = 'created_at',
  ascending = false,
): { rows: T[]; reload: () => Promise<void> } {
  const [rows, setRows] = useState<T[]>(initial)
  const supabaseRef = useRef(createClient())

  useEffect(() => {
    const supabase = supabaseRef.current
    const reload = async () => {
      const { data } = await supabase
        .from(table)
        .select('*')
        .eq('workspace_id', workspaceId)
        .order(orderBy, { ascending })
      if (data) setRows(data as T[])
    }
    const channel = supabase
      .channel(`${table}:${workspaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `workspace_id=eq.${workspaceId}` }, reload)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [table, workspaceId, orderBy, ascending])

  const reload = async () => {
    const { data } = await supabaseRef.current
      .from(table)
      .select('*')
      .eq('workspace_id', workspaceId)
      .order(orderBy, { ascending })
    if (data) setRows(data as T[])
  }

  return { rows, reload }
}
