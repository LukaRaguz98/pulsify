import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const name = (searchParams.get('name') ?? 'Welcome').slice(0, 40)
  const rawColor = (searchParams.get('color') ?? '6366f1').replace('#', '').slice(0, 6)
  const hex = /^[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : '6366f1'

  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)

  const dk = (v: number) => Math.max(0, Math.floor(v * 0.52)).toString(16).padStart(2, '0')
  const dark = `${dk(r)}${dk(g)}${dk(b)}`

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '400px',
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
        <div style={{
          position: 'absolute', top: '-110px', right: '-110px',
          width: '420px', height: '420px', borderRadius: '50%',
          background: 'rgba(255,255,255,0.07)', display: 'flex',
        }} />
        <div style={{
          position: 'absolute', bottom: '-90px', left: '-90px',
          width: '320px', height: '320px', borderRadius: '50%',
          background: 'rgba(255,255,255,0.04)', display: 'flex',
        }} />
        {/* Soft highlight */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(circle at 68% 48%, rgba(255,255,255,0.10) 0%, transparent 55%)',
          display: 'flex',
        }} />

        {/* Text */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', position: 'relative' }}>
          <div style={{
            fontSize: '15px', fontWeight: '600',
            color: 'rgba(255,255,255,0.60)',
            letterSpacing: '8px', textTransform: 'uppercase',
          }}>
            WELCOME TO
          </div>
          <div style={{
            fontSize: name.length > 22 ? '54px' : '70px',
            fontWeight: '900',
            color: '#ffffff',
            textAlign: 'center',
            letterSpacing: name.length > 22 ? '-1px' : '-2px',
            textShadow: '0 4px 28px rgba(0,0,0,0.32)',
            maxWidth: '900px',
            lineHeight: '1.05',
          }}>
            {name}
          </div>
          <div style={{
            width: '52px', height: '2px',
            background: 'rgba(255,255,255,0.38)',
            borderRadius: '1px', marginTop: '6px',
            display: 'flex',
          }} />
        </div>
      </div>
    ),
    { width: 1200, height: 400 },
  )
}
