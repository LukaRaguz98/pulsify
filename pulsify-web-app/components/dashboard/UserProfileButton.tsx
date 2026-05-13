'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { LogOut, Copy, Check, X } from 'lucide-react'

type Props = {
  displayName: string
  username?: string
  discriminator?: string
  discordId?: string
  email?: string
  avatarUrl?: string
  bannerUrl?: string
  bannerColor?: string
  collapsed?: boolean
  /** 'up' for sidebar (default), 'down' for top nav */
  popupDirection?: 'up' | 'down'
  avatarSize?: number
}

export function UserProfileButton({
  displayName,
  username,
  discriminator,
  discordId,
  email,
  avatarUrl,
  bannerUrl,
  bannerColor,
  collapsed = false,
  popupDirection = 'up',
  avatarSize = 26,
}: Props) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<React.CSSProperties>({})
  const [copied, setCopied] = useState<'id' | 'username' | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  const usernameTag = username
    ? discriminator && discriminator !== '0'
      ? `${username}#${discriminator.padStart(4, '0')}`
      : `@${username}`
    : null

  function openPopup() {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const popupWidth = 268

    if (popupDirection === 'down') {
      setCoords({
        top: rect.bottom + 8,
        left: Math.min(
          Math.max(8, rect.right - popupWidth),
          window.innerWidth - popupWidth - 8,
        ),
      })
    } else {
      setCoords({
        bottom: window.innerHeight - rect.top + 8,
        left: Math.min(rect.left, window.innerWidth - popupWidth - 8),
      })
    }
    setOpen(true)
  }

  const closePopup = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) closePopup()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closePopup()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, closePopup])

  function copy(text: string, key: 'id' | 'username') {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const avatarEl = avatarUrl ? (
    <Image
      src={avatarUrl}
      alt={displayName}
      width={avatarSize}
      height={avatarSize}
      className="rounded-full shrink-0"
      unoptimized
    />
  ) : (
    <div
      className="flex shrink-0 items-center justify-center rounded-full text-xs text-white font-bold"
      style={{
        width: avatarSize,
        height: avatarSize,
        background: 'linear-gradient(135deg, var(--cyan), var(--p-1))',
      }}
    >
      {displayName.charAt(0)}
    </div>
  )

  return (
    <>
      <button
        ref={btnRef}
        onClick={open ? closePopup : openPopup}
        title={collapsed ? displayName : undefined}
        className={`flex items-center rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors ${popupDirection === 'up' ? 'w-full' : 'w-auto'}`}
        style={{
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: collapsed ? '0' : '0.625rem',
          background: open ? (popupDirection === 'down' ? 'var(--bg-2)' : 'var(--panel)') : '',
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = popupDirection === 'down' ? 'var(--bg-2)' : 'var(--panel)'
        }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = '' }}
      >
        {avatarEl}
        {!collapsed && (
          <span className="flex-1 truncate text-left">{displayName}</span>
        )}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popupRef}
          className="rounded-xl border shadow-xl overflow-hidden"
          style={{
            position: 'fixed',
            width: '268px',
            background: 'var(--panel)',
            borderColor: 'var(--line-strong)',
            zIndex: 9999,
            boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            ...coords,
          }}
        >
          {/* Banner / header strip */}
          {bannerUrl ? (
            <div className="relative h-[72px]">
              <Image
                src={bannerUrl}
                alt="Banner"
                fill
                className="object-cover"
                unoptimized
              />
            </div>
          ) : (
            <div
              className="h-[72px]"
              style={{
                background: bannerColor
                  ? bannerColor
                  : 'linear-gradient(135deg, var(--p-soft), var(--bg-2))',
              }}
            />
          )}

          <div className="px-4 pb-3">
            {/* Avatar overlap + close btn */}
            <div className="flex items-end justify-between" style={{ marginTop: '-28px' }}>
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt={displayName}
                  width={56}
                  height={56}
                  className="rounded-full shrink-0 border-[3px]"
                  style={{ borderColor: 'var(--panel)' }}
                  unoptimized
                />
              ) : (
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-full shrink-0 text-xl text-white font-bold border-[3px]"
                  style={{
                    background: 'linear-gradient(135deg, var(--cyan), var(--p-1))',
                    borderColor: 'var(--panel)',
                  }}
                >
                  {displayName.charAt(0)}
                </div>
              )}
              <button
                onClick={closePopup}
                className="mb-1 flex h-6 w-6 items-center justify-center rounded-md transition-colors"
                style={{ color: 'var(--text-3)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.color = 'var(--text)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--text-3)' }}
              >
                <X size={13} />
              </button>
            </div>

            {/* Name */}
            <div className="mt-2">
              <p className="font-bold text-foreground leading-tight">{displayName}</p>
              {usernameTag && (
                <p className="text-xs text-subtle mt-0.5">{usernameTag}</p>
              )}
            </div>

            {/* Info box */}
            <div className="mt-3 rounded-lg p-3 space-y-2.5" style={{ background: 'var(--bg-2)' }}>
              {usernameTag && (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle mb-0.5">Username</p>
                    <p className="text-xs text-foreground font-mono truncate">{usernameTag}</p>
                  </div>
                  <button
                    onClick={() => copy(usernameTag, 'username')}
                    title="Copy"
                    className="shrink-0 flex h-6 w-6 items-center justify-center rounded transition-colors"
                    style={{ color: 'var(--text-3)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
                  >
                    {copied === 'username' ? <Check size={11} style={{ color: '#22c55e' }} /> : <Copy size={11} />}
                  </button>
                </div>
              )}

              {discordId && (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle mb-0.5">User ID</p>
                    <p className="text-xs text-foreground font-mono truncate">{discordId}</p>
                  </div>
                  <button
                    onClick={() => copy(discordId, 'id')}
                    title="Copy"
                    className="shrink-0 flex h-6 w-6 items-center justify-center rounded transition-colors"
                    style={{ color: 'var(--text-3)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
                  >
                    {copied === 'id' ? <Check size={11} style={{ color: '#22c55e' }} /> : <Copy size={11} />}
                  </button>
                </div>
              )}

              {email && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle mb-0.5">Email</p>
                  <p className="text-xs text-foreground truncate">{email}</p>
                </div>
              )}
            </div>

            <form action="/auth/logout" method="POST" className="mt-2">
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-subtle transition-colors"
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; e.currentTarget.style.color = '#f87171' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = '' }}
              >
                <LogOut size={13} />
                Log out
              </button>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
