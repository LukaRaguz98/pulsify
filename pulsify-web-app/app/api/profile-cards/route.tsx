import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

/**
 * Renders a member's profile fields as a grid of little "cards" (accent label +
 * value), laid out horizontally and wrapping onto rows. Used by the bot's
 * /profile reply so identity + activity read as tidy boxes side by side.
 *
 * `cards` is a URL-encoded JSON array of { l: label, v: value }. Transparent
 * background + subtle per-card panel so it blends and reads on light + dark
 * Discord. Built with next/og (Satori). Public + deterministic.
 *
 *   GET /api/profile-cards?color=8b5cf6&cards=%5B%7B%22l%22%3A%22Messages%22%2C%22v%22%3A%221%2C234%22%7D%5D
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const rawColor = (searchParams.get('color') ?? '8b5cf6').replace('#', '').slice(0, 6)
  const hex = /^[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : '8b5cf6'

  let parsed: { l?: unknown; v?: unknown }[] = []
  try {
    const j = JSON.parse(searchParams.get('cards') ?? '[]')
    if (Array.isArray(j)) parsed = j
  } catch {
    parsed = []
  }
  const cards = parsed
    .slice(0, 9)
    .map((c) => ({ l: String(c?.l ?? '').slice(0, 18), v: String(c?.v ?? '').slice(0, 24) }))
    .filter((c) => c.l || c.v)

  if (cards.length === 0) return new Response('No cards', { status: 400 })

  // 3× supersample → a higher-resolution source for Discord to downsample from,
  // so the embed looks sharper. Every dimension below is × S, so raising it
  // keeps the layout, aspect ratio and on-embed display size identical — only
  // the pixel density changes.
  const S = 3
  const CARD_W = 330
  // Compact cards (shorter + tighter gaps) so the overall image is a notch
  // shorter — Discord fits it to the content width, so less box height per card
  // means a smaller embed without losing crispness.
  const CARD_H = 82
  const GAP = 14
  const PAD = 12
  // 3 per row (not 4): Discord scales a single gallery image to the container's
  // content width, so a narrower, taller grid keeps far more resolution in the
  // preview than a wide 4-up strip — which collapses short and looks soft.
  const PER_ROW = 3

  const displayCols = Math.min(cards.length, PER_ROW)
  const rows = Math.ceil(cards.length / PER_ROW)
  const W = (displayCols * CARD_W + (displayCols - 1) * GAP + 2 * PAD) * S
  const H = (rows * CARD_H + (rows - 1) * GAP + 2 * PAD) * S

  const ACCENT = `#${hex}`
  const VALUE = '#e7eaef'
  const CARD_BG = 'rgba(120,125,135,0.12)'
  const CARD_BORDER = 'rgba(140,145,155,0.3)'

  return new ImageResponse(
    (
      <div
        style={{
          width: `${W}px`,
          height: `${H}px`,
          display: 'flex',
          flexWrap: 'wrap',
          alignContent: 'flex-start',
          gap: `${GAP * S}px`,
          padding: `${PAD * S}px`,
          // No background → transparent PNG that blends into the embed.
        }}
      >
        {cards.map((c, i) => (
          <div
            key={i}
            style={{
              width: `${CARD_W * S}px`,
              height: `${CARD_H * S}px`,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: `${6 * S}px`,
              padding: `0 ${18 * S}px`,
              background: CARD_BG,
              border: `${1 * S}px solid ${CARD_BORDER}`,
              borderRadius: `${16 * S}px`,
            }}
          >
            <div
              style={{
                fontSize: `${17 * S}px`,
                // The default next/og font is single-weight, so `fontWeight` is a
                // no-op — fake a bold with a tight 4-direction same-colour shadow
                // that thickens the glyphs (crisp, no blur) so the title reads.
                textShadow: `${0.9 * S}px 0 currentColor, -${0.9 * S}px 0 currentColor, 0 ${0.9 * S}px currentColor, 0 -${0.9 * S}px currentColor`,
                letterSpacing: `${1.5 * S}px`,
                textTransform: 'uppercase',
                color: ACCENT,
              }}
            >
              {c.l}
            </div>
            <div style={{ fontSize: `${24 * S}px`, fontWeight: 800, color: VALUE }}>{c.v}</div>
          </div>
        ))}
      </div>
    ),
    { width: W, height: H, headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } },
  )
}
