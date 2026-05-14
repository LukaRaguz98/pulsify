'use client'

import { usePreferences } from '@/components/ThemeProvider'

// Keyframes: all animated elements start and end at opacity:0 so that
// [data-animations="false"] (which forces duration:0.01ms, iteration:1)
// leaves them invisible via animationFillMode:'forwards'.
const KEYFRAMES = `
@keyframes _co{0%,100%{opacity:0}40%,60%{opacity:.28}}
@keyframes _co2{0%,100%{opacity:0}35%,65%{opacity:.2}}
@keyframes _cd{
  0%{stroke-dashoffset:240;opacity:0}
  20%{opacity:1}
  50%{stroke-dashoffset:0;opacity:1}
  80%{stroke-dashoffset:-240;opacity:1}
  100%{stroke-dashoffset:-240;opacity:0}
}
@keyframes _cdg{
  0%{stroke-dashoffset:240;opacity:0}
  20%{opacity:.5}
  50%{stroke-dashoffset:0;opacity:.5}
  80%{stroke-dashoffset:-240;opacity:.5}
  100%{stroke-dashoffset:-240;opacity:0}
}
@keyframes _cdp{0%,100%{opacity:0}40%,65%{opacity:.85}}
`

// ── Layout (all coordinates in a 320×320 SVG viewport) ─────────────────
//
// TR — viewport corner at SVG(320, 0)
//   main bracket : M228 28 H288 V208   (H-arm=60, V-arm=180, total=240)
//   outer bracket: M216 16 H302 V222   (larger, dashed)
//   corner dot   : (288, 28)
//   chamfer      : (279,28)→(288,37)
//   inner echo   : M272 36 H280 V44
//   ticks H      : x=258, y 22–34
//   ticks V 1/3  : y= 88, x 282–294
//   ticks V 2/3  : y=148, x 283–293
//   ticks V end  : y=208, x 283–293  (terminus cap)
//
// BL — viewport corner at SVG(0, 320)
//   main bracket : M92 292 H32 V112    (H-arm=60, V-arm=180, total=240)
//   outer bracket: M104 304 H18 V98    (larger, dashed)
//   corner dot   : (32, 292)
//   chamfer      : (41,283)→(32,292)
//   inner echo   : M48 284 H40 V276
//   ticks H      : x= 62, y 286–298
//   ticks V 1/3  : y=232, x  26– 38
//   ticks V 2/3  : y=172, x  27– 37
//   ticks V end  : y=112, x  26– 38  (terminus cap)

function CornerDeco({ pos }: { pos: 'tr' | 'bl' }) {
  const isTR = pos === 'tr'

  return (
    <svg
      aria-hidden="true"
      data-cd="true"
      style={{
        position: 'fixed',
        ...(isTR
          ? { top: 0, right: 0 }
          : { bottom: 0, left: 'var(--sidebar-w, 230px)', transition: 'left 0.2s ease' }),
        width: 320,
        height: 320,
        pointerEvents: 'none',
        zIndex: 10,
        overflow: 'hidden',
      }}
    >
      <defs>
        <filter id={`cd-g-${pos}`} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="30" />
        </filter>
      </defs>

      {/* ── Glow orb ── */}
      <ellipse
        cx={isTR ? 320 : 0}
        cy={isTR ? 0 : 320}
        rx={90} ry={90}
        filter={`url(#cd-g-${pos})`}
        style={{
          fill: 'var(--p-1)',
          animation: `_co 6s ease-in-out ${isTR ? '0s' : '-3s'} infinite forwards`,
        }}
      />

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

      {/* ── Glow trace — slightly ahead, soft leading/trailing edge ── */}
      <path
        d={isTR ? 'M228 28 H288 V208' : 'M92 292 H32 V112'}
        fill="none" strokeWidth={8} strokeLinecap="round"
        strokeDasharray={240} strokeDashoffset={240}
        style={{
          stroke: 'var(--p-1)',
          filter: 'blur(5px)',
          animation: `_cdg 5s ease-in-out ${isTR ? '-0.2s' : '-2.7s'} infinite forwards`,
        }}
      />

      {/* ── Main L-bracket (H=60, V=180, total=240) ── */}
      <path
        d={isTR ? 'M228 28 H288 V208' : 'M92 292 H32 V112'}
        fill="none" strokeWidth={1.5} strokeLinecap="round"
        strokeDasharray={240} strokeDashoffset={240}
        style={{
          stroke: 'var(--p-1)',
          filter: 'drop-shadow(0 0 5px var(--p-glow))',
          animation: `_cd 5s ease-in-out ${isTR ? '0s' : '-2.5s'} infinite forwards`,
        }}
      />

      {/* ── Corner dot ── */}
      <circle
        cx={isTR ? 288 : 32}
        cy={isTR ? 28 : 292}
        r={2.5}
        style={{
          fill: 'var(--p-1)',
          filter: 'drop-shadow(0 0 6px var(--p-glow))',
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

      {/* ── Inner echo bracket (nested 8 px inside main corner) ── */}
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
      {/* ── Terminus cap at V arm end ── */}
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
