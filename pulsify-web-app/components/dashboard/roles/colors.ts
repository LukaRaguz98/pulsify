// Discord-style role color palette + hex utilities used by the editor.

export type RoleColorSwatch = { hex: number; label: string }

export const DISCORD_ROLE_COLORS: RoleColorSwatch[] = [
  { hex: 0, label: 'Default' },
  { hex: 0x1abc9c, label: 'Teal' },
  { hex: 0x2ecc71, label: 'Green' },
  { hex: 0x3498db, label: 'Blue' },
  { hex: 0x9b59b6, label: 'Purple' },
  { hex: 0xe91e63, label: 'Magenta' },
  { hex: 0xf1c40f, label: 'Yellow' },
  { hex: 0xe67e22, label: 'Orange' },
  { hex: 0xe74c3c, label: 'Red' },
  { hex: 0x95a5a6, label: 'Gray' },
  { hex: 0x11806a, label: 'Dark Teal' },
  { hex: 0x1f8b4c, label: 'Dark Green' },
  { hex: 0x206694, label: 'Dark Blue' },
  { hex: 0x71368a, label: 'Dark Purple' },
  { hex: 0x992d22, label: 'Dark Red' },
]

export function hexString(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

export function parseHex(input: string): number | null {
  const cleaned = input.replace(/^#/, '').trim()
  if (!/^[0-9a-f]{6}$/i.test(cleaned)) return null
  return parseInt(cleaned, 16)
}
