import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getTintedPulseIcon, pulseIconFilename, PULSE_ICONS, type PulseIconName } from '@/lib/pulse-icon'

/**
 * Serves a Pulse brand icon recoloured to a requested hex.
 *
 * The bot fetches this for its `/sync` reply (same pattern as `/api/banner`)
 * so the tinting logic lives in one place — the web app — and the bot stays a
 * thin client without a native image dependency. Public + cacheable: the
 * output is a deterministic recolour of a bundled asset, no secrets involved.
 *
 *   GET /api/pulse-icon?icon=sync&color=8b5cf6
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const iconParam = (searchParams.get('icon') ?? 'guard') as PulseIconName
  const icon: PulseIconName = iconParam in PULSE_ICONS ? iconParam : 'guard'

  const rawColor = (searchParams.get('color') ?? '8b5cf6').replace('#', '').slice(0, 6)
  const hex = /^[0-9a-fA-F]{6}$/.test(rawColor) ? `#${rawColor}` : '#8b5cf6'

  const buffer = await getTintedPulseIcon(icon, hex)
  if (!buffer) {
    return NextResponse.json({ error: 'Icon not found' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `inline; filename="${pulseIconFilename(icon)}"`,
      // Deterministic output — let the bot host / CDN cache aggressively.
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  })
}
