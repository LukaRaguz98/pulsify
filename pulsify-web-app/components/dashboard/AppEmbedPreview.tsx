'use client'

import { useEffect, useState, type JSX, type CSSProperties } from 'react'
import Image from 'next/image'

type Props = {
  title: string
  content: string
  /** The `-# …` line under the title. It belongs to the HEADER — with a badge
   *  present the bot renders it inside the type-9 Section, beside the
   *  thumbnail, not down in the body. Pass it here rather than folding it into
   *  `content`, or the preview puts it in the wrong place. */
  subtitle?: string
  color?: string
  /** Public path to the branded badge shown top-right inside the container
   *  (e.g. '/pulse-info.png'). Omit for no badge — pass it only when the posted
   *  embed carries one, so the preview matches what Discord renders. */
  icon?: string
  /** Footer line (e.g. 'Pulse — Server Rules'). */
  footer?: string
  /** Whether a divider sits above the footer. Not every builder pushes one —
   *  the rules/onboarding, announcement and changelog containers do, the
   *  birthday announcement doesn't — so it has to be per-caller to stay 1:1. */
  footerDivider?: boolean
  /** When true, render for the animated PreviewStage field: transparent outer
   *  card + translucent glass container so the field glows through. */
  floating?: boolean
  /** The bold `Pulse` label above the title. On by default because every
   *  branded Pulse block carries it — pass false for a bare container that is
   *  only a title and its text (the per-rule rules embeds). */
  showBrand?: boolean
  /** Hide the avatar + username + timestamp row, the way Discord collapses it
   *  on consecutive messages from the same author. Use for every message after
   *  the first when previewing a run of them. */
  grouped?: boolean
}

function renderMd(text: string, lineIdx: number) {
  const parts: (string | JSX.Element)[] = []
  const regex = /(\*\*\*[\s\S]+?\*\*\*|\*\*[\s\S]+?\*\*|__[\s\S]+?__|~~[\s\S]+?~~|\*[\s\S]+?\*|`[^`]+`)/g
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const t = match[0]
    const k = `${lineIdx}-${key++}`
    if (t.startsWith('***'))      parts.push(<strong key={k}><em>{t.slice(3, -3)}</em></strong>)
    else if (t.startsWith('**'))  parts.push(<strong key={k}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('__'))  parts.push(<u key={k}>{t.slice(2, -2)}</u>)
    else if (t.startsWith('~~'))  parts.push(<del key={k}>{t.slice(2, -2)}</del>)
    else if (t.startsWith('`'))   parts.push(<code key={k} style={{ background: 'var(--bg)', padding: '1px 4px', borderRadius: '3px', fontSize: '12px', fontFamily: 'monospace' }}>{t.slice(1, -1)}</code>)
    else if (t.startsWith('*'))   parts.push(<em key={k}>{t.slice(1, -1)}</em>)
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

// Heading-aware line renderer — mirrors how Discord renders the V2
// TextDisplay markdown: `#`/`##`/`###` headings, `-#` subtext, blank lines as
// spacing. Everything else is a normal paragraph line.
function renderContent(text: string) {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('### ')) {
      return <div key={i} style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', margin: '6px 0 2px', lineHeight: 1.3 }}>{renderMd(line.slice(4), i)}</div>
    }
    if (line.startsWith('## ')) {
      return <div key={i} style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text)', margin: '8px 0 3px', lineHeight: 1.3 }}>{renderMd(line.slice(3), i)}</div>
    }
    if (line.startsWith('# ')) {
      return <div key={i} style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)', margin: '8px 0 4px', lineHeight: 1.3 }}>{renderMd(line.slice(2), i)}</div>
    }
    if (line.startsWith('-# ')) {
      return <div key={i} style={{ fontSize: '12px', color: 'var(--text-3)', margin: '2px 0', lineHeight: 1.3 }}>{renderMd(line.slice(3), i)}</div>
    }
    if (line.trim() === '') return <div key={i} style={{ height: '8px' }} />
    return <div key={i} style={{ lineHeight: '1.45' }}>{renderMd(line, i)}</div>
  })
}

export function AppEmbedPreview({
  title, content, subtitle, color, icon, footer, footerDivider = true, floating,
  showBrand = true, grouped = false,
}: Props) {
  // Render an empty placeholder on the server, then fill in the actual
  // current time on the client. Avoids hydration mismatch when the SSR's
  // "Today at HH:MM" differs from the client's clock by a minute (and from
  // the user's locale-formatted output).
  const [timeStr, setTimeStr] = useState('')
  useEffect(() => {
    setTimeStr(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
  }, [])

  // Let long, unbroken strings wrap instead of overflowing on narrow phones.
  const wrap = { overflowWrap: 'break-word', wordBreak: 'break-word' } as const

  // Translucent glass V2 container when floating on the animated field.
  const containerStyle: CSSProperties = floating
    ? {
        ...wrap,
        border: '1px solid var(--line)',
        borderLeftWidth: '3px',
        borderLeftColor: color ?? 'var(--p-1)',
        background: 'color-mix(in srgb, var(--panel-2) 55%, transparent)',
        borderRadius: '8px',
        padding: '12px 16px',
        maxWidth: '432px',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 20px 55px -26px color-mix(in srgb, var(--text) 30%, transparent)',
      }
    : {
        ...wrap,
        borderLeft: `4px solid ${color ?? 'var(--p-1)'}`,
        background: 'var(--bg-2)',
        borderRadius: '8px',
        padding: '12px 16px',
        maxWidth: '432px',
      }

  return (
    <div
      style={
        floating
          ? { fontFamily: "'gg sans', 'Noto Sans', Arial, sans-serif" }
          : {
              background: 'var(--panel)',
              borderRadius: '12px',
              padding: '16px 16px 12px',
              fontFamily: "'gg sans', 'Noto Sans', Arial, sans-serif",
              border: '1px solid var(--line-strong)',
            }
      }
    >
      <div className="flex items-start gap-2.5 sm:gap-4">
        {/* Bot avatar — a same-size spacer when grouped, so the container still
            lines up under the first message's body. */}
        {grouped ? (
          <div className="h-9 w-9 sm:h-10 sm:w-10" style={{ flexShrink: 0 }} aria-hidden />
        ) : (
          <Image
            src="/logo.png"
            alt="Pulse"
            width={40}
            height={40}
            className="h-9 w-9 sm:h-10 sm:w-10"
            style={{ flexShrink: 0, borderRadius: '50%', marginTop: '2px', objectFit: 'cover' }}
          />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Username row */}
          {!grouped && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text)', fontWeight: '600', fontSize: '14px' }}>Pulse</span>
              <span style={{
                background: '#5865f2', color: '#ffffff',
                borderRadius: '3px', padding: '1px 5px',
                fontSize: '9px', fontWeight: '700',
                letterSpacing: '0.4px', textTransform: 'uppercase', lineHeight: '1.4',
              }}>APP</span>
              <span style={{ color: 'var(--text-3)', fontSize: '12px' }}>Today at {timeStr}</span>
            </div>
          )}

          {/* Components V2 container — rounded card with a full-height left
              accent stripe. Mirrors the posted Pulse v2 embed: a `Pulse` label +
              `#` title heading beside the branded badge, the body, then a divider
              and footer (the /changelog + announcement style). */}
          <div style={containerStyle}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {showBrand && (
                  <div style={{ color: 'var(--text-2)', fontWeight: 700, fontSize: '12px', marginBottom: '2px' }}>Pulse</div>
                )}
                {/* 20px matches a `# ` heading, 17px a `## ` one — the bare
                    variant posts the smaller heading, so mirror it here. An
                    empty title is a legitimate choice there (the rule posts as
                    plain text), so drop the row rather than nagging for one. */}
                {(showBrand || title) && (
                  <div style={{
                    color: 'var(--text)',
                    fontWeight: '700',
                    fontSize: showBrand ? '20px' : '17px',
                    margin: '0 0 6px',
                    lineHeight: '1.3',
                  }}>
                    {title || <span style={{ color: 'var(--text-3)', fontWeight: 600, fontSize: '15px' }}>No title…</span>}
                  </div>
                )}
                {subtitle && (
                  <div style={{ color: 'var(--text-3)', fontSize: '12px', margin: '0 0 6px', lineHeight: 1.3 }}>
                    {subtitle}
                  </div>
                )}
                <div style={{
                  color: 'var(--text-2)',
                  fontSize: '14px',
                  lineHeight: '1.45',
                }}>
                  {content ? renderContent(content) : <span style={{ color: 'var(--text-3)' }}>No content yet…</span>}
                </div>
              </div>
              {icon && (
                <Image src={icon} alt="" width={40} height={40} style={{ flexShrink: 0, borderRadius: '6px', marginTop: '2px' }} />
              )}
            </div>
            {footer && (
              <div
                style={{
                  marginTop: footerDivider ? '12px' : '8px',
                  paddingTop: footerDivider ? '8px' : 0,
                  borderTop: footerDivider ? '1px solid var(--line-strong)' : undefined,
                  color: 'var(--text-3)',
                  fontSize: '12px',
                }}
              >
                {footer}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
