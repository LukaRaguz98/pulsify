'use client'

import { useEffect, useState, type JSX } from 'react'
import Image from 'next/image'

type EmbedField = { name: string; value: string; inline: boolean }

export type EmbedData = {
  color: string
  title: string
  description: string
  fields: EmbedField[]
  footer_text: string
  banner_url: string
}

type Props = {
  embed: EmbedData
  serverName: string
  /** Footer shown when the user left footer_text blank (e.g. 'Pulse · Welcome'),
   *  mirroring the bot's branded fallback. */
  footerFallback?: string
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

export function DiscordEmbedPreview({ embed, serverName, footerFallback }: Props) {
  const resolve = (text: string) =>
    text.replace(/\{server\}/g, serverName).replace(/\{user\}/g, '@NewMember')

  // Defer time computation to client mount to avoid SSR/CSR hydration drift.
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
              accent stripe. Mirrors the bot's V2 builder: title → `#` heading,
              fields → stacked bold-label blocks, banner → media gallery,
              footer → subtext. No inline-field grid (V2 stacks them). */}
          <div style={{
            background: 'var(--bg-2)',
            borderLeft: `4px solid ${embed.color}`,
            borderRadius: '8px',
            overflow: 'hidden',
            maxWidth: '432px',
            padding: '12px 16px',
          }}>
            {/* Pulse label — matches the `**Pulse**` line the bot puts at the
                top of the v2 container. */}
            <div style={{ color: 'var(--text-2)', fontWeight: 700, fontSize: '12px', marginBottom: '2px' }}>Pulse</div>

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
                margin: '0 0 10px', lineHeight: '1.45',
              }}>
                {renderContent(resolve(embed.description))}
              </div>
            )}

            {/* Fields — stacked bold-label blocks, one per row */}
            {embed.fields.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
                {embed.fields.map((field, i) => (
                  <div key={i}>
                    {/* These must be <div>, not <p>: the value renders
                        renderContent()'s block <div>s, and <p> can't contain a
                        <div> (invalid HTML → hydration error). */}
                    <div style={{ color: 'var(--text)', fontSize: '14px', fontWeight: '700', margin: '0 0 2px' }}>
                      {resolve(field.name)}
                    </div>
                    <div style={{ color: 'var(--text-2)', fontSize: '14px', margin: 0, lineHeight: '1.45' }}>
                      {renderContent(resolve(field.value))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Banner — media gallery image, full width with rounded corners */}
            {embed.banner_url && (
              <div style={{ marginTop: '4px' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={embed.banner_url}
                  alt=""
                  style={{
                    width: '100%', display: 'block',
                    aspectRatio: '3 / 1', objectFit: 'cover',
                    borderRadius: '8px',
                  }}
                />
              </div>
            )}

            {/* Divider + footer — the standardized Pulse v2 close. Honours the
                user's footer_text, falling back to the branded label. */}
            {(embed.footer_text || footerFallback) && (
              <>
                <div style={{ borderTop: '1px solid var(--line-strong)', margin: '12px 0 8px' }} />
                <div style={{ color: 'var(--text-3)', fontSize: '12px', lineHeight: '1.3' }}>
                  {embed.footer_text ? resolve(embed.footer_text) : footerFallback}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
