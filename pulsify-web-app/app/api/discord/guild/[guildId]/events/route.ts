import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import {
  fetchGuildEvents,
  createGuildEvent,
  DiscordFetchError,
  type EventMutation,
} from '@/lib/discord'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  try {
    const events = await fetchGuildEvents(guildId)
    return NextResponse.json(events)
  } catch (e) {
    const status = e instanceof DiscordFetchError ? e.status : 502
    return NextResponse.json(
      { error: "Couldn't verify your Discord access right now. Try again in a moment." },
      { status: status === 429 ? 429 : 502 },
    )
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as EventMutation & { reason?: string }
  const validationError = validateNewEvent(body)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const result = await createGuildEvent(guildId, body, body.reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.event)
}

// Discord rejects events that are missing required fields per-entity-type
// with a generic error — front-load the validation here so the dashboard can
// surface a clear message instead of "Invalid Form Body".
export function validateNewEvent(body: EventMutation): string | null {
  if (!body.name?.trim()) return 'Event name is required.'
  if (!body.scheduled_start_time) return 'Start time is required.'
  if (!body.entity_type) return 'Event type is required.'
  if (body.entity_type === 3) {
    if (!body.location?.trim()) return 'External events need a location.'
    if (!body.scheduled_end_time) return 'External events need an end time.'
  } else {
    if (!body.channel_id) return 'Voice and Stage events need a channel.'
  }
  return null
}
