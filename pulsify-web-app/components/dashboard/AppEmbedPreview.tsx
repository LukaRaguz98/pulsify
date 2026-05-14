'use client'

import type { JSX } from 'react'
import Image from 'next/image'

type Props = {
  title: string
  content: string
  color?: string
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

function renderContent(text: string) {
  return text.split('\n').flatMap((line, i, arr) => {
    const nodes = renderMd(line, i)
    return i < arr.length - 1 ? [...nodes, <br key={`br-${i}`} />] : nodes
  })
}

export function AppEmbedPreview({ title, content, color }: Props) {
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

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

          {/* Embed card */}
          <div style={{
            borderLeft: `4px solid ${color ?? 'var(--p-1)'}`,
            background: 'var(--bg-2)',
            borderRadius: '4px',
            padding: '10px 14px 12px',
          }}>
            <p style={{
              color: 'var(--text)',
              fontWeight: '600',
              fontSize: '15px',
              margin: '0 0 6px',
              lineHeight: '1.3',
            }}>
              {title || <span style={{ color: 'var(--text-3)' }}>No title…</span>}
            </p>
            <p style={{
              color: 'var(--text-2)',
              fontSize: '13.5px',
              margin: 0,
              lineHeight: '1.45',
            }}>
              {content ? renderContent(content) : <span style={{ color: 'var(--text-3)' }}>No content yet…</span>}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
