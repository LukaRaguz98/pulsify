import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export type AutomationRunStatus = 'success' | 'failed' | 'skipped' | 'retrying'

export type AutomationRunRow = {
  id: number
  automation_id: string | null
  guild_id: string
  automation_name: string | null
  action_type: string | null
  status: AutomationRunStatus
  detail: string | null
  attempt: number
  duration_ms: number | null
  triggered_by: string
  created_at: string
}

const ALLOWED_STATUS = new Set<AutomationRunStatus>(['success', 'failed', 'skipped', 'retrying'])

export async function GET(
  req: Request,
  ctx: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const limitParam = Number(url.searchParams.get('limit') ?? '200')
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(500, Math.floor(limitParam)))
    : 200

  const statusParam = (url.searchParams.get('status') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is AutomationRunStatus => ALLOWED_STATUS.has(s as AutomationRunStatus))
  const automationId = url.searchParams.get('automation')?.trim()

  let query = supabase
    .from('automation_runs')
    .select(
      'id, automation_id, guild_id, automation_name, action_type, status, detail, attempt, duration_ms, triggered_by, created_at',
    )
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (statusParam.length > 0) query = query.in('status', statusParam)
  if (automationId) query = query.eq('automation_id', automationId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json((data ?? []) as AutomationRunRow[])
}
