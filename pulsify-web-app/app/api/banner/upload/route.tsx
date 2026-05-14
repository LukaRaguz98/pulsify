import { NextResponse } from 'next/server'
import { ImageResponse } from 'next/og'
import { createClient } from '@/lib/supabase-server'

// Node.js runtime (not edge) — needed for Buffer and Supabase server client
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { guildId: string; name: string; color: string }
  const { guildId, name, color } = body

  const safeName = (name ?? 'Welcome').slice(0, 40)
  const rawColor = (color ?? '6366f1').replace('#', '').slice(0, 6)
  const hex = /^[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : '6366f1'

  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const dk = (v: number) => Math.max(0, Math.floor(v * 0.52)).toString(16).padStart(2, '0')
  const dark = `${dk(r)}${dk(g)}${dk(b)}`

  // Generate banner PNG
  const imageResponse = new ImageResponse(
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
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(circle at 68% 48%, rgba(255,255,255,0.10) 0%, transparent 55%)',
          display: 'flex',
        }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', position: 'relative' }}>
          <div style={{
            fontSize: '15px', fontWeight: '600',
            color: 'rgba(255,255,255,0.60)',
            letterSpacing: '8px', textTransform: 'uppercase',
          }}>
            WELCOME TO
          </div>
          <div style={{
            fontSize: safeName.length > 22 ? '54px' : '70px',
            fontWeight: '900', color: '#ffffff', textAlign: 'center',
            letterSpacing: safeName.length > 22 ? '-1px' : '-2px',
            textShadow: '0 4px 28px rgba(0,0,0,0.32)',
            maxWidth: '900px', lineHeight: '1.05',
          }}>
            {safeName}
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

  const buffer = Buffer.from(await imageResponse.arrayBuffer())

  const path = `${guildId}/banner.png`
  const { error: uploadError } = await supabase.storage
    .from('welcome-banners')
    .upload(path, buffer, { contentType: 'image/png', upsert: true })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = supabase.storage
    .from('welcome-banners')
    .getPublicUrl(path)

  return NextResponse.json({ url: publicUrl })
}
