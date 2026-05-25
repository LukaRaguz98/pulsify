'use client'

import { usePreferences } from '@/components/ThemeProvider'

// Keyframes for the animated corner brackets. _cd draws and erases the whole
// 480-unit L (60+180 doubled) so the line "travels" through the corner in one
// continuous pass.
const KEYFRAMES = `
@keyframes _co2{0%,100%{opacity:0}35%,65%{opacity:.2}}
@keyframes _cd{
  0%{stroke-dashoffset:480;opacity:0}
  20%{opacity:1}
  50%{stroke-dashoffset:0;opacity:1}
  80%{stroke-dashoffset:-480;opacity:1}
  100%{stroke-dashoffset:-480;opacity:0}
}
@keyframes _cdg{
  0%{stroke-dashoffset:480;opacity:0}
  20%{opacity:.55}
  50%{stroke-dashoffset:0;opacity:.55}
  80%{stroke-dashoffset:-480;opacity:.55}
  100%{stroke-dashoffset:-480;opacity:0}
}
@keyframes _cdp{0%,100%{opacity:0}40%,65%{opacity:.85}}
@keyframes _cd2{
  0%{stroke-dashoffset:400;opacity:0}
  20%{opacity:.45}
  50%{stroke-dashoffset:0;opacity:.45}
  80%{stroke-dashoffset:-400;opacity:.45}
  100%{stroke-dashoffset:-400;opacity:0}
}
`

// ── Layout (all coordinates in a 320×320 SVG viewport) ─────────────────
//
// TR — viewport corner at SVG(320, 0)
//   main bracket : M168 28 H288 V388   (H-arm=120, V-arm=360, total=480)
//   outer bracket: M216 16 H302 V222   (larger, dashed)
//   corner dot   : (288, 28)
//   chamfer      : (279,28)→(288,37)
//   inner Pulse   : M272 36 H280 V44
//   ticks H      : x=258, y 22–34
//   ticks V 1/3  : y= 88, x 282–294
//   ticks V 2/3  : y=148, x 283–293
//   ticks V end  : y=208, x 283–293
//
// BL — viewport corner at SVG(0, 320)
//   main bracket : M152 292 H32 V-68   (H-arm=120, V-arm=360, total=480)
//   outer bracket: M104 304 H18 V98    (larger, dashed)
//   corner dot   : (32, 292)
//   chamfer      : (41,283)→(32,292)
//   inner Pulse   : M48 284 H40 V276
//   ticks H      : x= 62, y 286–298
//   ticks V 1/3  : y=232, x  26– 38
//   ticks V 2/3  : y=172, x  27– 37
//   ticks V end  : y=112, x  26– 38

function CornerDeco({ pos }: { pos: 'tr' | 'bl' }) {
  const isTR = pos === 'tr'

  return (
    <svg
      aria-hidden="true"
      data-cd="true"
      data-cd-pos={pos}
      // Decorative HUD brackets are anchored to the sidebar edge; hidden below
      // lg where the sidebar is an off-canvas overlay so they don't float
      // mid-screen.
      className="max-lg:hidden"
      style={{
        position: 'fixed',
        ...(isTR
          ? { top: 0, right: 0 }
          : { bottom: 0, left: 'var(--sidebar-w, 230px)', transition: 'left 0.2s ease' }),
        width: 320,
        height: 320,
        pointerEvents: 'none',
        zIndex: 10,
        overflow: 'visible',
      }}
    >
      {/* ── Outer dashed bracket + diamond ── */}
      <path
        d={isTR ? 'M216 16 H302 V222' : 'M104 304 H18 V98'}
        fill="none" strokeWidth={0.5} strokeLinecap="round"
        strokeDasharray="2 9"
        style={{
          stroke: 'var(--p-1)',
          animation: `_co2 10s ease-in-out ${isTR ? '0s' : '-5s'} infinite forwards`,
        }}
      />
      <path
        d={isTR
          ? 'M302 12 L306 16 L302 20 L298 16 Z'
          : 'M18 300 L22 304 L18 308 L14 304 Z'}
        fill="none" strokeWidth={0.75}
        style={{
          stroke: 'var(--p-1)',
          animation: `_co2 10s ease-in-out ${isTR ? '0s' : '-5s'} infinite forwards`,
        }}
      />

      {/* ── Glow trace — soft halo travelling with the main bracket. Same
          path & timing as `_cd`, lower opacity ceiling, light blur, slightly
          thicker stroke. Rendered first so the sharp main line draws over it. ── */}
      <path
        d={isTR ? 'M168 28 H288 V388' : 'M152 292 H32 V-68'}
        fill="none" strokeWidth={6} strokeLinecap="round"
        strokeDasharray={480} strokeDashoffset={480}
        style={{
          stroke: 'var(--p-1)',
          filter: 'blur(3.5px)',
          animation: `_cdg 5s ease-in-out ${isTR ? '0s' : '-2.5s'} infinite forwards`,
        }}
      />

      {/* ── Main L-bracket (H=120, V=360, total=480 — doubled arms) ── */}
      <path
        d={isTR ? 'M168 28 H288 V388' : 'M152 292 H32 V-68'}
        fill="none" strokeWidth={1.5} strokeLinecap="round"
        strokeDasharray={480} strokeDashoffset={480}
        style={{
          stroke: 'var(--p-1)',
          animation: `_cd 5s ease-in-out ${isTR ? '0s' : '-2.5s'} infinite forwards`,
        }}
      />

      {/* ── Parallel inner line — slightly shorter arms (H=100, V=300,
          total=400) shifted 10px toward the screen's center, thinner stroke,
          lower opacity ceiling. Shares the draw/erase rhythm via its own
          _cd2 keyframe scaled to its 400-unit length. ── */}
      <path
        d={isTR ? 'M188 28 H288 V328' : 'M132 292 H32 V-8'}
        transform={isTR ? 'translate(-10 10)' : 'translate(10 -10)'}
        fill="none" strokeWidth={0.75} strokeLinecap="round"
        strokeDasharray={400} strokeDashoffset={400}
        style={{
          stroke: 'var(--p-1)',
          animation: `_cd2 5s ease-in-out ${isTR ? '0s' : '-2.5s'} infinite forwards`,
        }}
      />

      {/* ── Scanner pulse — bright dot riding the head of the line during the
          draw phase (0% → 50% of the cycle), then idle until the next loop.
          keyPoints "0;1;1" pins it at the path end while the bracket erases
          from the other side, mirroring the visual head of the stroke. ── */}
      <circle r={2.5} fill="var(--p-1)" style={{ filter: 'drop-shadow(0 0 4px var(--p-1))' }}>
        <animateMotion
          dur="5s"
          repeatCount="indefinite"
          keyTimes="0;0.5;1"
          keyPoints="0;1;1"
          calcMode="linear"
          path={isTR ? 'M168 28 H288 V388' : 'M152 292 H32 V-68'}
          begin={isTR ? '0s' : '-2.5s'}
        />
        <animate
          attributeName="opacity"
          values="0;1;1;0;0"
          keyTimes="0;0.05;0.5;0.55;1"
          dur="5s"
          repeatCount="indefinite"
          begin={isTR ? '0s' : '-2.5s'}
        />
      </circle>

      {/* ── Corner dot ── */}
      <circle
        cx={isTR ? 288 : 32}
        cy={isTR ? 28 : 292}
        r={2.5}
        style={{
          fill: 'var(--p-1)',
          animation: `_cdp 5s ease-in-out ${isTR ? '0s' : '-2.5s'} infinite forwards`,
        }}
      />

      {/* ── Chamfer diagonal at inner corner ── */}
      <line
        x1={isTR ? 279 : 41} y1={isTR ? 28 : 283}
        x2={isTR ? 288 : 32} y2={isTR ? 37 : 292}
        strokeWidth={1} strokeLinecap="round"
        style={{ stroke: 'var(--p-1)', opacity: 0.55 }}
      />

      {/* ── Inner Pulse bracket (nested 8 px inside main corner) ── */}
      <path
        d={isTR ? 'M272 36 H280 V44' : 'M48 284 H40 V276'}
        fill="none" strokeWidth={0.75} strokeLinecap="round"
        style={{ stroke: 'var(--p-1)', opacity: 0.22 }}
      />

      {/* ── Tick — H arm midpoint ── */}
      <line
        x1={isTR ? 258 : 62} y1={isTR ? 22 : 286}
        x2={isTR ? 258 : 62} y2={isTR ? 34 : 298}
        strokeWidth={0.75}
        style={{ stroke: 'var(--p-1)', opacity: 0.38 }}
      />
      {/* ── Tick — V arm 1/3 (60 px along arm) ── */}
      <line
        x1={isTR ? 282 : 26} y1={isTR ? 88 : 232}
        x2={isTR ? 294 : 38} y2={isTR ? 88 : 232}
        strokeWidth={0.75}
        style={{ stroke: 'var(--p-1)', opacity: 0.38 }}
      />
      {/* ── Tick — V arm 2/3 (120 px along arm) ── */}
      <line
        x1={isTR ? 283 : 27} y1={isTR ? 148 : 172}
        x2={isTR ? 293 : 37} y2={isTR ? 148 : 172}
        strokeWidth={0.5}
        style={{ stroke: 'var(--p-1)', opacity: 0.25 }}
      />
      {/* ── Terminus cap at original V arm end ── */}
      <line
        x1={isTR ? 283 : 26} y1={isTR ? 208 : 112}
        x2={isTR ? 293 : 38} y2={isTR ? 208 : 112}
        strokeWidth={0.75}
        style={{ stroke: 'var(--p-1)', opacity: 0.38 }}
      />
    </svg>
  )
}

export function CornerDecorations() {
  const { cornerDeco } = usePreferences()
  if (!cornerDeco) return null

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />
      <CornerDeco pos="tr" />
      <CornerDeco pos="bl" />
    </>
  )
}
