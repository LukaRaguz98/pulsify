'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireOperator } from '@/lib/operator'
import { MEMBER_VIEW_COOKIE } from '@/lib/guild-access'

/**
 * Operator-only: toggle the Member View preview. The cookie only ever
 * DOWNGRADES the operator's own experience (admin → member), so it grants
 * nothing — but the toggle is still gated so the switcher matches the
 * lock-marked UI that exposes it. Redirects to the guild home so the operator
 * never lands stranded on a now-restricted management page.
 */
export async function setMemberView(guildId: string, enabled: boolean): Promise<void> {
  const gate = await requireOperator()
  if (!gate.ok) return

  const cookieStore = await cookies()
  if (enabled) {
    cookieStore.set(MEMBER_VIEW_COOKIE, '1', { path: '/dashboard', sameSite: 'lax' })
  } else {
    // Expire with the same path it was set with — delete() assumes '/'.
    cookieStore.set(MEMBER_VIEW_COOKIE, '', { path: '/dashboard', maxAge: 0 })
  }
  redirect(`/dashboard/${guildId}`)
}
