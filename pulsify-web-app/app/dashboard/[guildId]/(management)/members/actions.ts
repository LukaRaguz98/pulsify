'use server'

import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import type { ModerationNote } from '@/lib/member-profile'

export type NoteResult =
  | { ok: true; note: ModerationNote }
  | { ok: false; error: string }

export type SimpleResult = { ok: true } | { ok: false; error: string }

const MAX_NOTE_LENGTH = 1000

/**
 * Add a moderator-only note to a member. Notes are never shown to the member —
 * they're a private record for the moderation team. Requires Manage Server /
 * Administrator on the guild.
 */
export async function addMemberNote(
  guildId: string,
  userId: string,
  body: string,
): Promise<NoteResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const trimmed = body.trim()
  if (trimmed.length === 0) return { ok: false, error: 'A note can’t be empty.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('moderation_notes')
    .insert({
      guild_id: guildId,
      user_id: userId,
      author_id: auth.moderator.userId,
      author_username: auth.moderator.username,
      body: trimmed.slice(0, MAX_NOTE_LENGTH),
    })
    .select('id, body, author_id, author_username, created_at')
    .single()

  if (error || !data) {
    return { ok: false, error: `Couldn’t save the note: ${error?.message ?? 'unknown error'}` }
  }
  return { ok: true, note: data as ModerationNote }
}

/**
 * Delete a moderation note. Any authorized moderator can remove a note — they
 * are a shared team record, not owned by one moderator.
 */
export async function deleteMemberNote(
  guildId: string,
  noteId: string,
): Promise<SimpleResult> {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase
    .from('moderation_notes')
    .delete()
    .eq('id', noteId)
    .eq('guild_id', guildId)

  if (error) return { ok: false, error: `Couldn’t delete the note: ${error.message}` }
  return { ok: true }
}
