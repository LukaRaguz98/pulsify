import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Pulse brand icon tinting.
 *
 * The Pulse Guard alert, the AutoMod warning DM, and the bot's `/sync` reply
 * all share one visual trick: a bundled white-on-transparent badge recoloured
 * on the fly to match the guild's configured Pulse Guard accent. Centralising
 * it here means every surface tints identically and we only ship one copy of
 * the sharp pixel-walk.
 *
 * Each icon is a PNG in `public/<name>.png`. Tinted results are cached per
 * (icon, hex) so the sharp pass runs once per colour per process.
 */

export const PULSE_ICONS = {
  /** Help glyph — the bot's /help reply. */
  help: 'pulse-help.png',
  /** Guard glyph - the Pulse Guard logo. */
  guard: 'pulse-help.png',
  /** Recap glyph — the Insights weekly recap posted to Discord. */
  recap: 'pulse-recap.png',
  /** Ticket glyph — the opening embed of a freshly-created support ticket. */
  ticket: 'pulse-ticket.png',
  /** Gift glyph — the giveaway embed posted/edited in Discord. */
  giveaway: 'pulse-giveaway.png',
  /** Megaphone glyph — the bot's /changelog (update) embed. */
  announcement: 'pulse-annoucement.png',
} as const

export type PulseIconName = keyof typeof PULSE_ICONS

const baseIconCache = new Map<PulseIconName, Buffer | null>()
const tintedIconCache = new Map<string, Buffer>()

async function loadBaseIcon(name: PulseIconName): Promise<Buffer | null> {
  if (baseIconCache.has(name)) return baseIconCache.get(name) ?? null
  try {
    const filePath = path.join(process.cwd(), 'public', PULSE_ICONS[name])
    const buf = await readFile(filePath)
    baseIconCache.set(name, buf)
    return buf
  } catch (err) {
    console.warn(`[pulse-icon] failed to load public/${PULSE_ICONS[name]}:`, err)
    baseIconCache.set(name, null)
    return null
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return { r: 139, g: 92, b: 246 } // fallback: pulsify violet
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

/**
 * Return the named Pulse icon recoloured to `hex`.
 *
 * Walks the PNG's raw RGBA pixels and lerps each between the target colour and
 * pure white based on a "whiteness" score. White pixels (the glyph) stay
 * white; saturated pixels (the plate) become the target colour; antialiased
 * edges get the smooth transition between the two.
 *
 *   whiteness = clamp01((1 - saturation·3) · brightness)
 *   output    = lerp(target, white, whiteness)
 *
 * Sharp is imported lazily so a broken native module degrades to the untinted
 * PNG rather than crashing the route.
 */
export async function getTintedPulseIcon(
  name: PulseIconName,
  hex: string,
): Promise<Buffer | null> {
  const base = await loadBaseIcon(name)
  if (!base) return null

  const key = `${name}:${hex.toLowerCase()}`
  const cached = tintedIconCache.get(key)
  if (cached) return cached

  try {
    const { default: sharp } = await import('sharp')
    const target = hexToRgb(hex)

    const { data, info } = await sharp(base)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const pixels = Buffer.from(data)
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      // alpha at i+3 is preserved as-is

      const maxC = Math.max(r, g, b)
      const minC = Math.min(r, g, b)
      const sat = maxC === 0 ? 0 : (maxC - minC) / maxC
      const brightness = maxC / 255
      // Saturation × 3 means anything with sat > ~0.33 is fully recoloured,
      // giving a tight antialias band rather than a muddy halo.
      const w = Math.max(0, Math.min(1, (1 - sat * 3) * brightness))

      pixels[i] = Math.round(target.r * (1 - w) + 255 * w)
      pixels[i + 1] = Math.round(target.g * (1 - w) + 255 * w)
      pixels[i + 2] = Math.round(target.b * (1 - w) + 255 * w)
    }

    const tinted = await sharp(pixels, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer()

    tintedIconCache.set(key, tinted)
    return tinted
  } catch (err) {
    console.warn(`[pulse-icon] tint failed for ${name}, using original:`, err)
    return base
  }
}

/** Filename Discord references via `attachment://<filename>`. */
export function pulseIconFilename(name: PulseIconName): string {
  return PULSE_ICONS[name]
}
