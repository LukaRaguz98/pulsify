import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

/**
 * Renders the /profile reputation + level bars as a SINGLE transparent PNG so
 * the bot can show both at once (reputation left, level right) blended into the
 * embed. One image — not a 2-up MediaGallery — so nothing gets cropped and the
 * whole thing always fits.
 *
 * The two columns sit SIDE BY SIDE so the block stays short (Discord scales a
 * single gallery image to the container's content width, so side-by-side keeps
 * the embed compact). Within each column the label + detail are stacked above
 * the bar: that keeps each column narrow enough to fit two across, while giving
 * the image enough height that it doesn't collapse into a soft strip. Built with
 * next/og (Satori). Public + deterministic.
 *
 *   GET /api/profile-bars?color=8b5cf6&repLabel=Reputation&repDetail=72/100%20%C2%B7%20Established&repPct=72
 *                         &lvl=1&lvlLabel=Level%201&lvlDetail=128/155%20XP&lvlPct=83
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const rawColor = (searchParams.get('color') ?? '8b5cf6').replace('#', '').slice(0, 6)
  const hex = /^[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : '8b5cf6'

  const clamp = (v: string | null) => Math.max(0, Math.min(100, Number(v ?? 0) || 0))
  const cut = (v: string | null) => (v ?? '').slice(0, 40)

  type Col = { pct: number; label: string; detail: string }
  const cols: Col[] = [
    {
      label: cut(searchParams.get('repLabel')) || 'Reputation',
      detail: cut(searchParams.get('repDetail')),
      pct: clamp(searchParams.get('repPct')),
    },
  ]
  if (searchParams.get('lvl') === '1') {
    cols.push({
      label: cut(searchParams.get('lvlLabel')) || 'Level',
      detail: cut(searchParams.get('lvlDetail')),
      pct: clamp(searchParams.get('lvlPct')),
    })
  }

  // 3× supersample → a higher-resolution source for Discord to downsample from,
  // so the embed looks sharper. Every dimension below is × S, so raising it
  // keeps the layout, aspect ratio and on-embed display size identical — only
  // the pixel density changes.
  const S = 3
  const ACCENT = `#${hex}`
  const DETAIL = '#d6dae1'
  const TRACK = 'rgba(140,140,150,0.25)'

  const PAD = 12
  const COL_GAP = 36
  // Fixed width keeps the side-by-side block compact (short) and gives each
  // column room for its label + detail on their own lines.
  const W = 700 * S
  const H = 92 * S

  return new ImageResponse(
    (
      <div
        style={{
          width: `${W}px`,
          height: `${H}px`,
          display: 'flex',
          flexDirection: 'row',
          gap: `${COL_GAP * S}px`,
          padding: `${PAD * S}px ${24 * S}px`,
          // No background → transparent PNG that blends into the embed.
        }}
      >
        {cols.map((c) => (
          <div
            key={c.label}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: `${7 * S}px`,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: `${3 * S}px` }}>
              <div style={{ fontSize: `${22 * S}px`, fontWeight: 800, color: ACCENT }}>{c.label}</div>
              {c.detail ? (
                <div style={{ fontSize: `${17 * S}px`, fontWeight: 700, color: DETAIL }}>{c.detail}</div>
              ) : null}
            </div>
            <div
              style={{
                display: 'flex',
                width: '100%',
                height: `${16 * S}px`,
                background: TRACK,
                borderRadius: `${8 * S}px`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  width: `${c.pct}%`,
                  height: '100%',
                  background: `#${hex}`,
                  borderRadius: `${8 * S}px`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    ),
    { width: W, height: H, headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } },
  )
}
