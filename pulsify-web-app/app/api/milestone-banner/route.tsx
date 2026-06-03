import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

/**
 * A full-width "Milestones" banner tinted to the guild's accent colour, posted
 * at the bottom of the bot's /milestones + /profile › Milestones embeds. Brand
 * language mirrors the welcome banner (/api/banner): accent gradient, decorative
 * circles, soft highlight, eyebrow + big title. `name` is an optional eyebrow
 * (the server name). Built with next/og (Satori). Public + deterministic.
 *
 *   GET /api/milestone-banner?color=8b5cf6&name=My%20Server
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const name = (searchParams.get('name') ?? '').slice(0, 40)
  const rawColor = (searchParams.get('color') ?? '8b5cf6').replace('#', '').slice(0, 6)
  const hex = /^[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : '8b5cf6'

  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const dk = (v: number) => Math.max(0, Math.floor(v * 0.52)).toString(16).padStart(2, '0')
  const dark = `${dk(r)}${dk(g)}${dk(b)}`

  const eyebrow = (name || 'Recognition').toUpperCase()

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '300px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(135deg, #${dark} 0%, #${hex} 55%, #${hex}bb 100%)`,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative circles */}
        <div style={{ position: 'absolute', top: '-90px', right: '-90px', width: '340px', height: '340px', borderRadius: '50%', background: 'rgba(255,255,255,0.07)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: '-80px', left: '-80px', width: '260px', height: '260px', borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex' }} />
        {/* Soft highlight */}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 68% 46%, rgba(255,255,255,0.10) 0%, transparent 55%)', display: 'flex' }} />

        {/* Text */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', position: 'relative' }}>
          <div style={{ fontSize: '15px', fontWeight: '600', color: 'rgba(255,255,255,0.62)', letterSpacing: '9px', textTransform: 'uppercase' }}>
            {eyebrow}
          </div>
          <div style={{ fontSize: '76px', fontWeight: '900', color: '#ffffff', letterSpacing: '-2px', textShadow: '0 4px 28px rgba(0,0,0,0.32)', lineHeight: '1.05' }}>
            Milestones
          </div>
          <div style={{ width: '52px', height: '2px', background: 'rgba(255,255,255,0.38)', borderRadius: '1px', marginTop: '4px', display: 'flex' }} />
        </div>
      </div>
    ),
    { width: 1200, height: 300, headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable' } },
  )
}
