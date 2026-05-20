'use client'

import { useRef } from 'react'
import Image from 'next/image'
import {
  Bot,
  Upload,
  X,
  RotateCcw,
  AlertCircle,
  AlertTriangle,
  Sparkles,
} from 'lucide-react'
import { SectionCard } from '@/components/ui/section-card'
import type { BotBrandingResponse } from '@/lib/bot-branding'

const MAX_AVATAR_BYTES = 1024 * 1024 // 1 MB
const MIN_DIM = 16
const MAX_DIM = 4096
const MAX_NICK_LEN = 32
const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

type Props = {
  loading: boolean
  branding: BotBrandingResponse | null
  /** Custom display name in this server. */
  nickname: string
  onNicknameChange: (v: string) => void
  /** '' = unchanged · data URI = new avatar · null = clear to default */
  avatar: string | null | ''
  onAvatarChange: (v: string | null | '') => void
  /** Surface validation messages through the page-level toast. */
  onNotice: (kind: 'ok' | 'err', text: string) => void
  error?: string | null
}

/**
 * Per-server bot branding editor. Presentational + controlled: the parent
 * (ServerSettingsContent) owns the branding state and persists it through the
 * page's global Save bar, so there's no separate save button here. This card
 * just renders the name/avatar editor, a live preview, image validation, and a
 * stage-only "reset to default" that clears the fields for the next save.
 */
export function BotBrandingCard({
  loading,
  branding,
  nickname,
  onNicknameChange,
  avatar,
  onAvatarChange,
  onNotice,
  error,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function onPickAvatar(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      onNotice('err', 'Pick a PNG, JPEG, GIF, or WEBP image.')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      onNotice('err', 'Avatar must be under 1 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (!result) return
      // Validate dimensions before accepting — Discord rejects extremes and
      // center-crops non-square avatars, so warn rather than silently distort.
      const img = new window.Image()
      img.onload = () => {
        if (img.width < MIN_DIM || img.height < MIN_DIM) {
          onNotice('err', `Avatar must be at least ${MIN_DIM}×${MIN_DIM}px.`)
          return
        }
        if (img.width > MAX_DIM || img.height > MAX_DIM) {
          onNotice('err', `Avatar must be at most ${MAX_DIM}×${MAX_DIM}px.`)
          return
        }
        onAvatarChange(result)
        if (img.width !== img.height) {
          onNotice('err', 'Heads up: non-square images are center-cropped by Discord.')
        }
      }
      img.onerror = () => onNotice('err', "That image couldn't be read.")
      img.src = result
    }
    reader.readAsDataURL(file)
  }

  // ── Loading / empty states ──────────────────────────────────────────────
  if (loading) {
    return (
      <SectionCard title="Bot Branding" description="Give the Pulse bot a custom name and avatar in this server.">
        <div className="flex items-center gap-3">
          <div className="h-16 w-16 animate-pulse rounded-2xl" style={{ background: 'var(--bg-2)' }} />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded" style={{ background: 'var(--bg-2)' }} />
            <div className="h-9 w-full animate-pulse rounded-lg" style={{ background: 'var(--bg-2)' }} />
          </div>
        </div>
      </SectionCard>
    )
  }

  if (!branding) {
    return (
      <SectionCard title="Bot Branding" description="Give the Pulse bot a custom name and avatar in this server.">
        <div
          className="flex items-start gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error ?? 'Could not load bot branding.'}
        </div>
      </SectionCard>
    )
  }

  const { permissions, current, lastUpdated } = branding
  const defaultName = branding.default.name
  const defaultAvatar = branding.default.avatarUrl

  const previewName = nickname.trim() || defaultName
  const previewAvatar =
    avatar === '' ? (current.avatarUrl ?? defaultAvatar) : avatar === null ? defaultAvatar : avatar

  const nameDirty = nickname.trim() !== (current.nickname ?? '')
  const avatarDirty = avatar !== ''
  const dirty = nameDirty || avatarDirty
  const usingCustom = Boolean(current.nickname || current.avatarUrl)
  // "Reset to default" stages a clear (name → '', avatar → null) for the next
  // save. Only meaningful when something custom is set or staged.
  const canResetToDefault = usingCustom || nickname.trim() !== '' || avatar !== null

  const lockedReason = !permissions.inGuild
    ? 'The Pulse bot is not a member of this server.'
    : !permissions.canChangeNickname
      ? 'The Pulse bot is missing the "Change Nickname" permission, so its name can\'t be changed here.'
      : null

  return (
    <SectionCard
      title="Bot Branding"
      description="Give the Pulse bot a custom name and avatar in this server. Changes apply to this server only and sync with Discord when you save."
      footer={
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          {lastUpdated
            ? <>Last changed {new Date(lastUpdated.at).toLocaleString()}{lastUpdated.by ? ` by ${lastUpdated.by}` : ''}. Edits save with the rest of your settings.</>
            : usingCustom
              ? 'Custom branding is active. Edits save with the rest of your settings.'
              : 'Using the default Pulse branding. Edits save with the rest of your settings.'}
        </p>
      }
    >
      {lockedReason && (
        <div
          className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}
        >
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {lockedReason}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Editor ─────────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-3)' }}>
              Display name in this server
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => onNicknameChange(e.target.value)}
              maxLength={MAX_NICK_LEN}
              placeholder={defaultName}
              disabled={!permissions.canChangeNickname || !permissions.inGuild}
              className="w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors disabled:opacity-50"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
            />
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
              {nickname.trim()
                ? `${nickname.length} / ${MAX_NICK_LEN} characters`
                : `Leave blank to use the default name (${defaultName}).`}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-3)' }}>
              Avatar
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED.join(',')}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onPickAvatar(file)
                e.target.value = ''
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!permissions.canChangeAvatar || !permissions.inGuild}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              >
                <Upload size={12} />
                Upload avatar
              </button>
              {(current.avatarUrl || (avatar && avatar !== '')) && avatar !== null && (
                <button
                  type="button"
                  onClick={() => onAvatarChange(null)}
                  disabled={!permissions.canChangeAvatar || !permissions.inGuild}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
                  style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.06)', color: '#f87171' }}
                >
                  <X size={12} />
                  Remove
                </button>
              )}
              {avatar !== '' && (
                <button
                  type="button"
                  onClick={() => onAvatarChange('')}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition"
                  style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
                >
                  <RotateCcw size={12} />
                  Undo avatar change
                </button>
              )}
            </div>
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
              PNG, JPEG, GIF, or WEBP. Max 1 MB. Square recommended. Per-server avatars depend on Discord support.
            </p>
          </div>

          <button
            type="button"
            onClick={() => { onNicknameChange(''); onAvatarChange(null) }}
            disabled={!canResetToDefault || !permissions.inGuild}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
          >
            <RotateCcw size={12} />
            Reset to default branding
          </button>
        </div>

        {/* ── Live preview ───────────────────────────────────────────────── */}
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            <Sparkles size={12} /> Preview
          </p>
          <div
            className="rounded-xl border p-4"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
          >
            <div className="flex items-start gap-3">
              {previewAvatar ? (
                <Image
                  src={previewAvatar}
                  alt="Bot avatar preview"
                  width={44}
                  height={44}
                  className="rounded-full"
                  unoptimized
                />
              ) : (
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-full text-white"
                  style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
                >
                  <Bot size={20} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold" style={{ color: 'var(--p-1)' }}>
                    {previewName}
                  </span>
                  <span
                    className="rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
                    style={{ background: 'var(--p-1)' }}
                  >
                    App
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                    Today
                  </span>
                </div>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-2)' }}>
                  This is how the bot appears to members in this server.
                </p>
              </div>
            </div>
          </div>
          {dirty && (
            <p className="mt-2 text-xs" style={{ color: 'var(--p-1)' }}>
              Unsaved changes — save to sync with Discord.
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
