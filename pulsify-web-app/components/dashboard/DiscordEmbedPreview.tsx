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

export function DiscordEmbedPreview({ embed, serverName }: Props) {
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

          {/* Embed card */}
          <div style={{
            background: 'var(--bg-2)',
            borderLeft: `4px solid ${embed.color}`,
            borderRadius: '4px',
            overflow: 'hidden',
            maxWidth: '432px',
          }}>
            {/* Text content */}
            <div style={{ padding: '8px 16px 0 12px' }}>
              {/* Title */}
              <p style={{
                color: 'var(--text)', fontWeight: '600',
                fontSize: '15px', margin: '8px 0 6px', lineHeight: '1.3',
              }}>
                {resolve(embed.title)}
              </p>

              {/* Description */}
              <p style={{
                color: 'var(--text-2)', fontSize: '13.5px',
                margin: '0 0 10px', lineHeight: '1.45',
              }}>
                {renderContent(resolve(embed.description))}
              </p>

              {/* Fields */}
              {embed.fields.length > 0 && (() => {
                const inlineCount = Math.min(embed.fields.filter(f => f.inline).length, 3)
                const cols = inlineCount > 1 ? inlineCount : 1
                return (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  gap: '6px 8px',
                  marginBottom: '10px',
                }}>
                  {embed.fields.map((field, i) => (
                    <div key={i} style={{ gridColumn: field.inline ? 'span 1' : `1 / -1` }}>
                      <p style={{ color: 'var(--text)', fontSize: '12px', fontWeight: '600', margin: '0 0 2px' }}>
                        {field.name}
                      </p>
                      <p style={{ color: 'var(--text-2)', fontSize: '12px', margin: 0, lineHeight: '1.35' }}>
                        {renderContent(field.value)}
                      </p>
                    </div>
                  ))}
                </div>
                )
              })()}
            </div>

            {/* Image */}
            {embed.banner_url && (
              <div style={{ padding: '4px 8px 8px' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={embed.banner_url}
                  alt=""
                  style={{
                    width: '100%', display: 'block',
                    aspectRatio: '3 / 1', objectFit: 'cover',
                    borderRadius: '4px',
                  }}
                />
              </div>
            )}

            {/* Footer */}
            {embed.footer_text && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '4px 12px 10px',
                borderTop: embed.banner_url ? 'none' : '1px solid var(--line-strong)',
              }}>
                <div style={{
                  width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0,
                  background: 'var(--p-1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '8px', fontWeight: '700',
                }}>P</div>
                <span style={{ color: 'var(--text-3)', fontSize: '11.5px' }}>
                  {resolve(embed.footer_text)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
