import { Palette } from 'lucide-react'

/**
 * How a cosmetic reward looks once owned — shared by the member shop card
 * (RewardCard) and the operator/admin editor (RewardEditPanel).
 *   • badge      → the exact chip rendered on the global Pulse profile.
 *   • corner_hud → a small dashboard mock showing the animated corner brackets
 *     (the HUD uses the live theme accent var(--p-1), not a per-item colour).
 */
export function CosmeticPreview({ effect, name, color }: { effect: string; name: string; color: string }) {
  if (effect === 'corner_hud') {
    const c = 'var(--p-1)'
    return (
      <div className="rounded-lg border p-4" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-subtle">In your dashboard corners</p>
        <div
          className="relative mx-auto h-24 w-full max-w-[280px] overflow-hidden rounded-md"
          style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}
        >
          <span className="absolute right-2 top-2 h-6 w-6" style={{ borderTop: `2px solid ${c}`, borderRight: `2px solid ${c}`, borderTopRightRadius: 4 }} />
          <span className="absolute bottom-2 left-2 h-6 w-6" style={{ borderBottom: `2px solid ${c}`, borderLeft: `2px solid ${c}`, borderBottomLeftRadius: 4 }} />
          <span className="absolute inset-0 flex items-center justify-center text-[10px] text-subtle">Dashboard</span>
        </div>
      </div>
    )
  }
  // Passive badge — exactly how the chip renders on the global Pulse profile.
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-subtle">On your Pulse profile</p>
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
        style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
      >
        <Palette size={12} /> {name.trim() || 'Cosmetic'}
      </span>
    </div>
  )
}
