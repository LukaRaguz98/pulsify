/**
 * Fixed, decorative backdrop for the landing page: a faint grid (concentrated
 * near the top behind the hero, faded out below via a radial mask) plus two
 * soft accent glows for depth. Pointer-events-none and pinned behind content
 * (zIndex 0, beneath the app-wide `z-index: 1` content layer).
 */
export function LandingBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 0 }}>
      {/* Grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 85% 55% at 50% 0%, #000 0%, transparent 72%)',
          WebkitMaskImage: 'radial-gradient(ellipse 85% 55% at 50% 0%, #000 0%, transparent 72%)',
          opacity: 0.55,
        }}
      />
      {/* Soft accent glows */}
      <div
        className="absolute -right-40 top-[30%] h-[520px] w-[520px] rounded-full blur-[150px]"
        style={{ background: 'radial-gradient(circle, var(--p-glow), transparent 70%)', opacity: 0.22 }}
      />
      <div
        className="absolute -left-40 top-[68%] h-[420px] w-[420px] rounded-full blur-[150px]"
        style={{ background: 'radial-gradient(circle, var(--cyan), transparent 70%)', opacity: 0.1 }}
      />
    </div>
  )
}
