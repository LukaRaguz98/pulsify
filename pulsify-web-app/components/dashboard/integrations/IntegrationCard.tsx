'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hash, Clock, Settings, Send, Pause, Play, MoreVertical, Unplug, Trash2, Plug, Loader2, Ban } from 'lucide-react'
import {
  STATUS_META,
  HEALTH_META,
  health,
  timeAgo,
  providerById,
  isConnectable,
  type Integration,
  type IntegrationProvider,
} from '@/lib/integrations'
import { IntegrationIcon } from './icons'

// ── Available (not-yet-connected) provider card ───────────────────────────────

export function ProviderCard({
  provider,
  connectedCount,
  onConnect,
}: {
  provider: IntegrationProvider
  connectedCount: number
  onConnect: () => void
}) {
  const connectable = isConnectable(provider)

  // Providers with no usable API (TikTok, X) or not-yet-built (Kick) are shown
  // for discoverability but can't be connected — render a static, dimmed card
  // with the reason instead of a clickable button.
  if (!connectable) {
    return (
      <div
        className="flex flex-col rounded-2xl border p-4 text-left"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', opacity: 0.7 }}
      >
        <div className="flex items-start gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}
          >
            <IntegrationIcon name={provider.icon} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-semibold" style={{ color: 'var(--text-2)' }}>{provider.name}</p>
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
                style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}
              >
                {provider.availability === 'planned' ? 'Coming soon' : 'Unavailable'}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm" style={{ color: 'var(--text-3)' }}>
              {provider.availabilityNote ?? provider.blurb}
            </p>
          </div>
        </div>
        <div
          className="mt-3 flex items-center gap-1.5 border-t pt-3 text-xs"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
        >
          <Ban size={13} /> Can’t be connected
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onConnect}
      className="group flex flex-col rounded-2xl border p-4 text-left transition-all"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--p-1)'
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--line-strong)'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `${provider.accent}1f`, color: provider.accent }}
        >
          <IntegrationIcon name={provider.icon} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-foreground">{provider.name}</p>
            {connectedCount > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
                style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
              >
                {connectedCount} active
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-sm" style={{ color: 'var(--text-3)' }}>
            {provider.blurb}
          </p>
        </div>
      </div>
      <div
        className="mt-3 flex items-center justify-between gap-2 border-t pt-3 text-xs"
        style={{ borderColor: 'var(--line-strong)' }}
      >
        <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
          {provider.capabilities.sync ? 'Notifications · Sync' : 'Notifications'}
        </span>
        <span
          className="inline-flex items-center gap-1 font-semibold transition-colors group-hover:text-[var(--p-1)]"
          style={{ color: 'var(--text-2)' }}
        >
          <Plug size={13} /> Connect
        </span>
      </div>
    </button>
  )
}

// ── Connected integration card ────────────────────────────────────────────────

type Busy = null | 'test' | 'toggle' | 'reconnect'

export function IntegrationCard({
  integration,
  channelName,
  onOpen,
  onTest,
  onToggle,
  onDisconnect,
  onReconnect,
  onDelete,
}: {
  integration: Integration
  channelName?: string
  onOpen: () => void
  onTest: () => Promise<void>
  onToggle: () => Promise<void>
  // Disconnect/remove are confirmed in a parent dialog, so they only signal
  // intent here (no in-card busy spinner — the dialog owns that state).
  onDisconnect: () => void
  onReconnect: () => Promise<void>
  onDelete: () => void
}) {
  const [busy, setBusy] = useState<Busy>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // The action menu renders in a portal (below) so it escapes the section's
  // stacking context — the universal `* { z-index: 1 }` rule otherwise lets the
  // next section's heading paint over an in-card dropdown. `menuCoords` is the
  // fixed viewport position derived from the trigger button.
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null)
  const MENU_WIDTH = 176 // w-44

  const openMenu = () => {
    const r = menuBtnRef.current?.getBoundingClientRect()
    if (!r) return
    setMenuCoords({ top: r.bottom + 4, left: Math.max(8, r.right - MENU_WIDTH) })
    setMenuOpen(true)
  }

  // Close on scroll/resize so the fixed-position menu can't drift from its trigger.
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menuOpen])

  const provider = providerById(integration.provider)
  const statusMeta = STATUS_META[integration.status]
  const h = health(integration)
  const healthMeta = HEALTH_META[h]

  const run = async (kind: Busy, fn: () => Promise<void>) => {
    setBusy(kind)
    setMenuOpen(false)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  const accent = provider?.accent ?? 'var(--p-1)'

  return (
    <div
      className="relative flex flex-col rounded-2xl border p-4 transition-all"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      {/* Header: glyph + label + health dot */}
      <div className="flex items-start gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `${accent}1f`, color: accent }}
        >
          <IntegrationIcon name={provider?.icon ?? 'Plug'} size={20} />
        </span>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-foreground">{integration.label}</p>
          </div>
          <p className="truncate text-xs" style={{ color: 'var(--text-3)' }}>
            {provider?.name ?? integration.provider}
          </p>
        </button>

        {/* Health indicator */}
        <span
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ color: healthMeta.color, background: `${healthMeta.color}1f` }}
          title={statusMeta.label}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: healthMeta.color }} />
          {healthMeta.label}
        </span>
      </div>

      {/* Meta: channel + last sync */}
      <div
        className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs"
        style={{ color: 'var(--text-3)' }}
      >
        <span className="inline-flex items-center gap-1 truncate">
          <Hash size={12} />
          {integration.channel_id ? (channelName ?? integration.channel_id) : 'No channel'}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock size={12} />
          Synced {timeAgo(integration.last_sync_at)}
        </span>
      </div>

      {integration.status === 'error' && integration.last_error && (
        <p className="mt-2 line-clamp-2 text-[11px]" style={{ color: '#f87171' }} title={integration.last_error}>
          {integration.last_error}
        </p>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-1.5 border-t pt-3" style={{ borderColor: 'var(--line-strong)' }}>
        <button
          type="button"
          onClick={() => run('test', onTest)}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
          style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
          title="Send a test notification"
        >
          {busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          Test
        </button>

        {integration.status === 'disconnected' ? (
          <button
            type="button"
            onClick={() => run('reconnect', onReconnect)}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            {busy === 'reconnect' ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
            Reconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={() => run('toggle', onToggle)}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
            title={integration.enabled ? 'Pause notifications' : 'Resume notifications'}
          >
            {busy === 'toggle' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : integration.enabled ? (
              <Pause size={13} />
            ) : (
              <Play size={13} />
            )}
            {integration.enabled ? 'Pause' : 'Resume'}
          </button>
        )}

        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors"
          style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
          title="Settings"
        >
          <Settings size={13} />
        </button>

        <div className="ml-auto">
          <button
            ref={menuBtnRef}
            type="button"
            onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
            disabled={busy !== null}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-50"
            style={{ color: 'var(--text-3)' }}
            aria-label="More actions"
          >
            <MoreVertical size={15} />
          </button>
          {menuOpen && menuCoords && createPortal(
            <>
              <button
                type="button"
                className="fixed inset-0 cursor-default"
                style={{ zIndex: 9998 }}
                aria-hidden
                onClick={() => setMenuOpen(false)}
              />
              <div
                className="fixed w-44 overflow-hidden rounded-xl border py-1 shadow-lg"
                style={{ top: menuCoords.top, left: menuCoords.left, zIndex: 9999, background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
              >
                {integration.status !== 'disconnected' && (
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); onDisconnect() }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-2)]"
                    style={{ color: 'var(--text-2)' }}
                  >
                    <Unplug size={14} /> Disconnect
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onDelete() }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-2)]"
                  style={{ color: '#f87171' }}
                >
                  <Trash2 size={14} /> Remove
                </button>
              </div>
            </>,
            document.body,
          )}
        </div>
      </div>
    </div>
  )
}
