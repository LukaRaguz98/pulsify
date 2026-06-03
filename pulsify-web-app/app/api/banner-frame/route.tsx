import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

/**
 * Normalises a member's Discord profile banner onto a fixed-aspect canvas so
 * the /profile embed always shows it at a consistent size, centred and
 * full-width — regardless of the source banner's dimensions (they vary per
 * user). The image is cover-fit + centred, so it fills the frame cleanly.
 *
 * Only Discord's CDN is allowed as a source (SSRF guard). Built with next/og
 * (Satori) like /api/banner.
 *
 *   GET /api/banner-frame?url=https%3A%2F%2Fcdn.discordapp.com%2Fbanners%2F...
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const url = searchParams.get('url') ?? ''

  // SSRF guard — only proxy Discord's own CDN.
  if (!/^https:\/\/cdn\.discordapp\.com\/[\w./?=&%-]+$/.test(url)) {
    return new Response('Invalid banner URL', { status: 400 })
  }

  // 3:1 — wider than Discord's native 2.5:1 banner so the framed image sits
  // shorter in the embed (centred cover crop, top + bottom only). Keeps the
  // profile compact without rendering off-centre. Rendered at high resolution
  // (same 3:1) so Discord has a sharper source to downsample — display size in
  // the embed is unchanged (driven by the aspect ratio, not the pixel count).
  const W = 1800
  const H = 600

  return new ImageResponse(
    (
      <div style={{ width: `${W}px`, height: `${H}px`, display: 'flex' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          width={W}
          height={H}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    ),
    { width: W, height: H, headers: { 'Cache-Control': 'public, max-age=21600, s-maxage=21600' } },
  )
}
