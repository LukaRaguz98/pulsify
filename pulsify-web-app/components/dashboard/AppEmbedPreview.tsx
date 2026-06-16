'use client'

import { useEffect, useState, type JSX } from 'react'
import Image from 'next/image'

type Props = {
  title: string
  content: string
  color?: string
  /** Public path to the branded badge shown top-right inside the container
   *  (e.g. '/pulse-info.png'). Omit for no badge. */
  icon?: string
  /** Footer line rendered under a divider (e.g. 'Pulse — Server Rules'). */
  footer?: string
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

export function AppEmbedPreview({ title, content, color, icon, footer }: Props) {
  // Render an empty placeholder on the server, then fill in the actual
  // current time on the client. Avoids hydration mismatch when the SSR's
  // "Today at HH:MM" differs from the client's clock by a minute (and from
  // the user's locale-formatted output).
  const [timeStr, setTimeStr] = useState('')
  useEffect(() => {
    setTimeStr(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
  }, [])

  return (
    <div
      style={{
        background: 'var(--panel)',
        borderRadius: '12px',
        padding: '16px 16px 12px',
        fontFamily: "'gg sans', 'Noto Sans', Arial, sans-serif",
        border: '1px solid var(--line-strong)',
      }}
    >
      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        {/* Bot avatar */}
        <Image
          src="/logo.png"
          alt="Pulse"
          width={40}
          height={40}
          style={{ flexShrink: 0, borderRadius: '50%', marginTop: '2px', objectFit: 'cover' }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Username row */}
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

          {/* Components V2 container — rounded card with a full-height left
              accent stripe. Mirrors the posted Pulse v2 embed: a `Pulse` label +
              `#` title heading beside the branded badge, the body, then a divider
              and footer (the /changelog + announcement style). */}
          <div style={{
            borderLeft: `4px solid ${color ?? 'var(--p-1)'}`,
            background: 'var(--bg-2)',
            borderRadius: '8px',
            padding: '12px 16px',
            maxWidth: '432px',
          }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--text-2)', fontWeight: 700, fontSize: '12px', marginBottom: '2px' }}>Pulse</div>
                <div style={{
                  color: 'var(--text)',
                  fontWeight: '700',
                  fontSize: '20px',
                  margin: '0 0 6px',
                  lineHeight: '1.3',
                }}>
                  {title || <span style={{ color: 'var(--text-3)', fontWeight: 600, fontSize: '15px' }}>No title…</span>}
                </div>
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
              <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid var(--line-strong)', color: 'var(--text-3)', fontSize: '12px' }}>
                {footer}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
