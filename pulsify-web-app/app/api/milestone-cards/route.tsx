import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

/**
 * Renders a member's milestones as a grid of achievement cards — mirroring the
 * in-app milestone cards (components/dashboard/members/MemberMilestones.tsx):
 * name, threshold, and either an "Unlocked" state or a live progress bar. Used
 * by the bot's /profile › Milestones page + /milestones reply so the embed reads
 * like the dashboard instead of a plain text list.
 *
 * `cards` is a URL-encoded JSON array of:
 *   { n: name, t: threshold label, e: 0|1 earned, p: 0-100 pct, v: value label }
 * Transparent background + subtle per-card panel so it blends on light + dark
 * Discord. Built with next/og (Satori). Public + deterministic.
 *
 *   GET /api/milestone-cards?color=8b5cf6&cards=%5B...%5D
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const rawColor = (searchParams.get('color') ?? '8b5cf6').replace('#', '').slice(0, 6)
  const hex = /^[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : '8b5cf6'

  let parsed: { n?: unknown; t?: unknown; e?: unknown; p?: unknown; v?: unknown }[] = []
  try {
    const j = JSON.parse(searchParams.get('cards') ?? '[]')
    if (Array.isArray(j)) parsed = j
  } catch {
    parsed = []
  }
  const cards = parsed
    .slice(0, 9)
    .map((c) => ({
      n: String(c?.n ?? '').slice(0, 40),
      t: String(c?.t ?? '').slice(0, 30),
      e: c?.e === 1 || c?.e === true,
      p: Math.max(0, Math.min(100, Math.round(Number(c?.p) || 0))),
      v: String(c?.v ?? '').slice(0, 36),
    }))
    .filter((c) => c.n)

  if (cards.length === 0) return new Response('No cards', { status: 400 })

  // Always render a full 3×3 board (9 slots): real milestones first, then blank
  // placeholder cards fill the remainder so the embed reads as a complete grid.
  const SLOTS = 9
  const PER_ROW = 3
  const slots: ((typeof cards)[number] | null)[] = Array.from({ length: SLOTS }, (_, i) => cards[i] ?? null)

  // 3× supersample → a sharper source for Discord to downsample (same trick as
  // /api/profile-cards). Every dimension is × S so layout/aspect are unchanged.
  const S = 3
  const CARD_W = 300
  const CARD_H = 116
  const GAP = 14
  const PAD = 12

  const cols = PER_ROW
  const rows = Math.ceil(SLOTS / PER_ROW)
  const W = (cols * CARD_W + (cols - 1) * GAP + 2 * PAD) * S
  const H = (rows * CARD_H + (rows - 1) * GAP + 2 * PAD) * S

  const ACCENT = `#${hex}`
  const GREEN = '#22c55e'
  const VALUE = '#e7eaef'
  const MUTED = '#9aa1ad'
  const CARD_BG = 'rgba(120,125,135,0.12)'
  const CARD_BORDER = 'rgba(140,145,155,0.3)'
  const TRACK = 'rgba(140,145,155,0.25)'
  // Faint, empty placeholder for unused slots.
  const BLANK_BG = 'rgba(120,125,135,0.05)'
  const BLANK_BORDER = 'rgba(140,145,155,0.15)'
  // Fake bold for the single-weight next/og default font (crisp 4-dir shadow,
  // same trick as /api/profile-cards). `px` is the pre-supersample offset.
  const faux = (px: number) => {
    const o = px * S
    return `${o}px 0 currentColor, -${o}px 0 currentColor, 0 ${o}px currentColor, 0 -${o}px currentColor`
  }

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
        }}
      >
        {slots.map((c, i) =>
          !c ? (
            <div
              key={i}
              style={{
                width: `${CARD_W * S}px`,
                height: `${CARD_H * S}px`,
                display: 'flex',
                background: BLANK_BG,
                border: `${1 * S}px dashed ${BLANK_BORDER}`,
                borderRadius: `${16 * S}px`,
              }}
            />
          ) : (
          <div
            key={i}
            style={{
              width: `${CARD_W * S}px`,
              height: `${CARD_H * S}px`,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: `${16 * S}px ${18 * S}px`,
              background: CARD_BG,
              border: `${1 * S}px solid ${c.e ? GREEN : CARD_BORDER}`,
              borderRadius: `${16 * S}px`,
            }}
          >
            {/* Title block */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: `${5 * S}px` }}>
              <div
                style={{
                  display: 'flex',
                  fontSize: `${13 * S}px`,
                  textShadow: faux(0.8),
                  letterSpacing: `${1.4 * S}px`,
                  textTransform: 'uppercase',
                  color: c.e ? GREEN : ACCENT,
                }}
              >
                {c.e ? '✓ Unlocked' : c.t}
              </div>
              <div style={{ display: 'flex', fontSize: `${23 * S}px`, color: VALUE, textShadow: faux(0.9) }}>
                {c.n}
              </div>
            </div>

            {/* Progress / state block */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: `${7 * S}px` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: `${14 * S}px`, color: MUTED }}>
                <div style={{ display: 'flex' }}>{c.e ? c.t : c.v}</div>
                <div style={{ display: 'flex', color: c.e ? GREEN : ACCENT }}>{c.e ? '100%' : `${c.p}%`}</div>
              </div>
              <div
                style={{
                  display: 'flex',
                  width: '100%',
                  height: `${9 * S}px`,
                  background: TRACK,
                  borderRadius: `${99 * S}px`,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.max(3, c.e ? 100 : c.p)}%`,
                    height: '100%',
                    background: c.e ? GREEN : ACCENT,
                    borderRadius: `${99 * S}px`,
                  }}
                />
              </div>
            </div>
          </div>
          ),
        )}
      </div>
    ),
    { width: W, height: H, headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } },
  )
}
