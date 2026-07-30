'use client'

import { useEffect, useState, type JSX, type CSSProperties } from 'react'
import Image from 'next/image'

export type EmbedData = {
  color: string
  title: string
  description: string
}

type Props = {
  embed: EmbedData
  serverName: string
  /** When true, render for the animated PreviewStage field: the outer card is
   *  transparent and the V2 container becomes translucent glass so the field
   *  glows through — matching the onboarding live preview. */
  floating?: boolean
}

/** The blue pill Discord renders for a `<@user>` / `<@&role>` mention. */
function Mention({ label }: { label: string }) {
  return (
    <span
      style={{
        background: 'color-mix(in srgb, #5865f2 28%, transparent)',
        color: 'var(--text)',
        borderRadius: '3px',
        padding: '0 2px',
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      @{label}
    </span>
  )
}

function renderMd(text: string, lineIdx: number) {
  const parts: (string | JSX.Element)[] = []
  // `<@…>` / `<@&…>` first so a mention is never eaten by the emphasis rules.
  const regex = /(<@&?[^>]{1,64}>|\*\*\*[\s\S]+?\*\*\*|\*\*[\s\S]+?\*\*|__[\s\S]+?__|~~[\s\S]+?~~|\*[\s\S]+?\*|`[^`]+`)/g
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const t = match[0]
    const k = `${lineIdx}-${key++}`
    if (t.startsWith('<@'))       parts.push(<Mention key={k} label={t.replace(/^<@&?/, '').replace(/>$/, '')} />)
    else if (t.startsWith('***')) parts.push(<strong key={k}><em>{t.slice(3, -3)}</em></strong>)
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

// Heading-aware line renderer — mirrors how Discord renders V2 TextDisplay
// markdown: `#`/`##`/`###` headings, `-#` subtext, blank lines as spacing.
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

export function DiscordEmbedPreview({ embed, serverName, floating }: Props) {
  // {user} becomes a raw Discord mention, exactly what the bot substitutes —
  // renderMd turns `<@…>` into the blue pill Discord shows.
  const resolve = (text: string) =>
    text.replace(/\{server\}/g, serverName).replace(/\{user\}/g, '<@Member>')

  // Defer time computation to client mount to avoid SSR/CSR hydration drift.
  const [timeStr, setTimeStr] = useState('')
  useEffect(() => {
    setTimeStr(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
  }, [])

  // Translucent glass V2 container when floating on the animated field.
  // Let long, unbroken strings (URLs, long titles) wrap instead of overflowing
  // the container and forcing horizontal scroll on narrow phones.
  const wrap = { overflowWrap: 'break-word', wordBreak: 'break-word' } as const

  const containerStyle: CSSProperties = floating
    ? {
        ...wrap,
        background: 'color-mix(in srgb, var(--panel-2) 55%, transparent)',
        border: '1px solid var(--line)',
        borderLeftWidth: '3px',
        borderLeftColor: embed.color,
        borderRadius: '8px',
        overflow: 'hidden',
        maxWidth: '432px',
        padding: '12px 16px',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 20px 55px -26px color-mix(in srgb, var(--text) 30%, transparent)',
      }
    : {
        ...wrap,
        background: 'var(--bg-2)',
        borderLeft: `4px solid ${embed.color}`,
        borderRadius: '8px',
        overflow: 'hidden',
        maxWidth: '432px',
        padding: '12px 16px',
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
        {/* Bot avatar */}
        <Image
          src="/logo.png"
          alt="Pulse"
          width={40}
          height={40}
          className="h-9 w-9 sm:h-10 sm:w-10"
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
              accent stripe. Mirrors buildMemberV2Container in the bot's
              index.js, which is deliberately bare: a `#` title heading and the
              message, nothing else. No `Pulse` label, no cards, no banner, no
              footer — a greeting should be the smallest thing in the channel. */}
          <div style={containerStyle}>
            {/* Title — H1 heading */}
            {resolve(embed.title) && (
              <div style={{
                color: 'var(--text)', fontWeight: '700',
                fontSize: '20px', margin: '0 0 6px', lineHeight: '1.3',
              }}>
                {resolve(embed.title)}
              </div>
            )}

            {/* Description */}
            {resolve(embed.description) && (
              <div style={{
                color: 'var(--text-2)', fontSize: '14px',
                lineHeight: '1.45',
              }}>
                {renderContent(resolve(embed.description))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
