// Dependency-free PNG export for the role Hierarchy view. Rather than rasterize
// live DOM (needs a heavy lib like html2canvas), we hand-draw a clean summary
// onto a <canvas> with the Canvas 2D API and trigger a download. Mirrors the
// dependency-free export approach used by the Assets manager. Client-only.

import { CATEGORY_META, ROLE_CATEGORIES, type RoleHierarchy } from './role-hierarchy'

const WIDTH = 920
const PAD = 40
const HEADER_H = 96
const CAT_HEADER_H = 44
const ROLE_ROW_H = 30
const CAT_GAP = 22

// Theme-ish dark palette baked in so the export looks consistent regardless of
// the user's live CSS variables (canvas can't read those).
const COL = {
  bg: '#0c0e14',
  panel: '#151823',
  line: '#262b3a',
  text: '#f1f3f8',
  subtle: '#9aa3b5',
}

export function exportHierarchyPng(hierarchy: RoleHierarchy, serverLabel?: string): void {
  const { groups, stats } = hierarchy

  // Measure total height: header + each non-empty category (its header + rows).
  let bodyH = 0
  const visibleCats = ROLE_CATEGORIES.filter((c) => groups[c].length > 0)
  for (const cat of visibleCats) {
    bodyH += CAT_HEADER_H + groups[cat].length * ROLE_ROW_H + CAT_GAP
  }
  const height = HEADER_H + bodyH + PAD

  const canvas = document.createElement('canvas')
  // Render at 2x for crisp text on high-DPI displays.
  const scale = 2
  canvas.width = WIDTH * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(scale, scale)

  // Background
  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, WIDTH, height)

  // Header
  ctx.fillStyle = COL.text
  ctx.font = '700 26px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillText('Role Hierarchy', PAD, PAD)
  ctx.fillStyle = COL.subtle
  ctx.font = '400 14px system-ui, -apple-system, Segoe UI, sans-serif'
  const summary = `${stats.totalRoles} roles  ·  ${stats.managementCount} management  ·  ${stats.botsCount} bots  ·  ${stats.communityCount} community`
  ctx.fillText(summary, PAD, PAD + 36)
  if (serverLabel) {
    ctx.fillText(serverLabel, PAD, PAD + 58)
  }

  let y = HEADER_H

  for (const cat of visibleCats) {
    const meta = CATEGORY_META[cat]
    const roles = groups[cat]

    // Category header bar
    ctx.fillStyle = COL.panel
    roundRect(ctx, PAD, y, WIDTH - PAD * 2, CAT_HEADER_H, 10)
    ctx.fill()
    // Accent pip
    ctx.fillStyle = meta.accent
    roundRect(ctx, PAD + 14, y + CAT_HEADER_H / 2 - 6, 12, 12, 3)
    ctx.fill()
    ctx.fillStyle = COL.text
    ctx.font = '700 16px system-ui, -apple-system, Segoe UI, sans-serif'
    ctx.fillText(meta.label, PAD + 38, y + 13)
    ctx.fillStyle = COL.subtle
    ctx.font = '400 13px system-ui, -apple-system, Segoe UI, sans-serif'
    const countLabel = `${roles.length} role${roles.length === 1 ? '' : 's'}`
    const cw = ctx.measureText(countLabel).width
    ctx.fillText(countLabel, WIDTH - PAD - 16 - cw, y + 15)

    y += CAT_HEADER_H + 6

    // Role rows
    for (const r of roles) {
      // Color dot
      ctx.fillStyle = r.color
      ctx.beginPath()
      ctx.arc(PAD + 22, y + ROLE_ROW_H / 2, 5, 0, Math.PI * 2)
      ctx.fill()
      // Name
      ctx.fillStyle = COL.text
      ctx.font = '500 14px system-ui, -apple-system, Segoe UI, sans-serif'
      const name = truncate(ctx, r.role.name, WIDTH - PAD * 2 - 160)
      ctx.fillText(name, PAD + 38, y + 7)
      // Member count (right aligned)
      ctx.fillStyle = COL.subtle
      ctx.font = '400 13px system-ui, -apple-system, Segoe UI, sans-serif'
      const mc = `${r.memberCount} member${r.memberCount === 1 ? '' : 's'}`
      const mw = ctx.measureText(mc).width
      ctx.fillText(mc, WIDTH - PAD - 16 - mw, y + 8)
      y += ROLE_ROW_H
    }

    y += CAT_GAP
  }

  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'role-hierarchy.png'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, 'image/png')
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
  return t + '…'
}
