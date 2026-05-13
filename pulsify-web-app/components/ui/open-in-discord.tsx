'use client'

import { ExternalLink } from 'lucide-react'

type Props = {
  /** Full https://discord.com/... URL used as web fallback */
  webUrl: string
  /** discord:// deep-link URL. Defaults to the discord:// equivalent of webUrl. */
  appUrl?: string
  label?: string
  className?: string
  style?: React.CSSProperties
}

export function OpenInDiscordButton({ webUrl, appUrl, label = 'Open in Discord', className, style }: Props) {
  const resolvedAppUrl = appUrl ?? webUrl.replace('https://discord.com', 'discord://discord.com')

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()

    window.location.href = resolvedAppUrl

    const fallback = setTimeout(() => {
      window.open(webUrl, '_blank', 'noopener,noreferrer')
    }, 1500)

    const cancel = () => {
      clearTimeout(fallback)
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', cancel)
    }

    window.addEventListener('blur', cancel, { once: true })
    document.addEventListener('visibilitychange', cancel, { once: true })
  }

  return (
    <button
      onClick={handleClick}
      className={
        'inline-flex items-center gap-2 whitespace-nowrap ' +
        (className ?? 'rounded-lg border px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition')
      }
      style={style ?? (className ? undefined : { borderColor: 'var(--line-strong)' })}
      onMouseEnter={(e) => {
        if (!className && !style) e.currentTarget.style.borderColor = 'var(--text-3)'
      }}
      onMouseLeave={(e) => {
        if (!className && !style) e.currentTarget.style.borderColor = 'var(--line-strong)'
      }}
    >
      <ExternalLink size={14} />
      {label}
    </button>
  )
}
