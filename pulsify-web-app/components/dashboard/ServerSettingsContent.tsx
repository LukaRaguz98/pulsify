'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import {
  Loader2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Shield,
  Server,
  Crown,
  Users,
  Sparkles,
  Bell,
  Filter,
  Volume2,
  MessageSquare,
  BookOpen,
  Megaphone,
  Hash,
  Upload,
  X,
  Link2,
  Copy,
  Plus,
  Trash2,
  CircleSlash,
} from 'lucide-react'
import {
  CHANNEL_TYPES,
  guildIconUrl,
  type BotPermissions,
  type DiscordChannel,
  type DiscordGuildFull,
  type DiscordInvite,
} from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { SectionCard } from '@/components/ui/section-card'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SaveBar } from '@/components/ui/save-bar'
import { BotBrandingCard } from '@/components/dashboard/server-settings/BotBrandingCard'
import type { BotBrandingResponse } from '@/lib/bot-branding'
import {
  PulseAssistantSections,
  DEFAULT_PULSE_PREFS,
  PULSE_PREFS_KEY,
  type PulsePrefs,
} from '@/components/dashboard/Pulse/PulseAssistantTab'
import { getEmbedColor, saveEmbedColor } from '@/app/dashboard/[guildId]/(management)/server-settings/actions'

type Props = { guildId: string }

type Toast = { kind: 'ok' | 'err'; text: string }

type GuildOwner = {
  id: string
  username: string
  global_name: string | null
  avatar: string | null
} | null

// ─── Editable shape ───────────────────────────────────────────────────────────

type EditState = {
  name: string
  /** "" means unchanged; data URI means a new icon; null means clear. */
  iconDataUri: string | null | ''
  verification_level: 0 | 1 | 2 | 3 | 4
  default_message_notifications: 0 | 1
  explicit_content_filter: 0 | 1 | 2
  afk_channel_id: string | null
  afk_timeout: number
  system_channel_id: string | null
  rules_channel_id: string | null
  public_updates_channel_id: string | null
}

const VERIFICATION_OPTIONS: { value: 0 | 1 | 2 | 3 | 4; label: string; sub: string }[] = [
  { value: 0, label: 'None',       sub: 'Unrestricted' },
  { value: 1, label: 'Low',        sub: 'Verified email' },
  { value: 2, label: 'Medium',     sub: 'Registered 5+ min' },
  { value: 3, label: 'High',       sub: 'In server 10+ min' },
  { value: 4, label: 'Very High',  sub: 'Verified phone' },
]

const NOTIFICATION_OPTIONS: { value: 0 | 1; label: string; sub: string }[] = [
  { value: 0, label: 'All Messages',  sub: 'Notify on every message' },
  { value: 1, label: 'Only @mentions', sub: 'Quieter default' },
]

const EXPLICIT_FILTER_OPTIONS: { value: 0 | 1 | 2; label: string; sub: string }[] = [
  { value: 0, label: 'Disabled',  sub: 'No filtering' },
  { value: 1, label: 'Members without roles', sub: 'Scan unroled members only' },
  { value: 2, label: 'All members', sub: 'Scan every message' },
]

const AFK_TIMEOUT_OPTIONS: { value: number; label: string }[] = [
  { value: 60,   label: '1 minute' },
  { value: 300,  label: '5 minutes' },
  { value: 900,  label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '1 hour' },
]

function buildEditState(g: DiscordGuildFull): EditState {
  return {
    name: g.name,
    iconDataUri: '',
    verification_level: (g.verification_level ?? 0) as 0 | 1 | 2 | 3 | 4,
    default_message_notifications: (g.default_message_notifications ?? 0) as 0 | 1,
    explicit_content_filter: (g.explicit_content_filter ?? 0) as 0 | 1 | 2,
    afk_channel_id: g.afk_channel_id ?? null,
    afk_timeout: g.afk_timeout ?? 300,
    system_channel_id: g.system_channel_id ?? null,
    rules_channel_id: g.rules_channel_id ?? null,
    public_updates_channel_id: g.public_updates_channel_id ?? null,
  }
}

function diffEditState(initial: EditState, current: EditState): Partial<EditState> {
  const out: Partial<EditState> = {}
  if (current.name !== initial.name) out.name = current.name
  if (current.iconDataUri !== '' && current.iconDataUri !== initial.iconDataUri) {
    out.iconDataUri = current.iconDataUri
  }
  if (current.verification_level !== initial.verification_level) {
    out.verification_level = current.verification_level
  }
  if (current.default_message_notifications !== initial.default_message_notifications) {
    out.default_message_notifications = current.default_message_notifications
  }
  if (current.explicit_content_filter !== initial.explicit_content_filter) {
    out.explicit_content_filter = current.explicit_content_filter
  }
  if (current.afk_channel_id !== initial.afk_channel_id) out.afk_channel_id = current.afk_channel_id
  if (current.afk_timeout !== initial.afk_timeout) out.afk_timeout = current.afk_timeout
  if (current.system_channel_id !== initial.system_channel_id) {
    out.system_channel_id = current.system_channel_id
  }
  if (current.rules_channel_id !== initial.rules_channel_id) {
    out.rules_channel_id = current.rules_channel_id
  }
  if (current.public_updates_channel_id !== initial.public_updates_channel_id) {
    out.public_updates_channel_id = current.public_updates_channel_id
  }
  return out
}

export function ServerSettingsContent({ guildId }: Props) {
  const [guild, setGuild] = useState<DiscordGuildFull | null>(null)
  const [channels, setChannels] = useState<DiscordChannel[]>([])
  const [botPerms, setBotPerms] = useState<BotPermissions | null>(null)
  const [owner, setOwner] = useState<GuildOwner>(null)

  const [initial, setInitial] = useState<EditState | null>(null)
  const [edit, setEdit] = useState<EditState | null>(null)

  // Bot branding (saved together with the rest via the global Save bar).
  const [branding, setBranding] = useState<BotBrandingResponse | null>(null)
  const [brandingLoading, setBrandingLoading] = useState(true)
  const [brandingNick, setBrandingNick] = useState('')
  // '' = unchanged · data URI = new avatar · null = clear to default
  const [brandingAvatar, setBrandingAvatar] = useState<string | null | ''>('')

  // Pulse assistant preferences (moved here from the old Automations settings).
  // Generation prefs stay client-only (localStorage); the embed colour is also
  // persisted to guild_settings so the bot applies it to every embed. Both are
  // folded into the same Save bar below.
  const [pulsePrefs, setPulsePrefs] = useState<PulsePrefs>(DEFAULT_PULSE_PREFS)
  const [pulseSnapshot, setPulseSnapshot] = useState<PulsePrefs>(DEFAULT_PULSE_PREFS)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  // Invites tab state.
  const [invites, setInvites] = useState<DiscordInvite[]>([])
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(null)
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [createInviteOpen, setCreateInviteOpen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // ── Loading ───────────────────────────────────────────────────────────────

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    const [guildRes, channelsRes, botRes, brandingRes] = await Promise.all([
      fetch(`/api/discord/guild/${guildId}`, { cache: 'no-store' }),
      fetch(`/api/discord/guild/${guildId}/channels`, { cache: 'no-store' }),
      fetch(`/api/discord/guild/${guildId}/bot-permissions`, { cache: 'no-store' }),
      fetch(`/api/discord/guild/${guildId}/bot-branding`, { cache: 'no-store' }),
    ])

    if (!guildRes.ok) {
      const data = (await guildRes.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Could not load server.')
      setLoading(false)
      setRefreshing(false)
      return
    }

    const guildData = (await guildRes.json()) as DiscordGuildFull
    setGuild(guildData)
    const initialEdit = buildEditState(guildData)
    setInitial(initialEdit)
    setEdit((prev) => {
      // Preserve pending edits if we're silently refreshing after save.
      if (!prev || silent) return initialEdit
      return prev
    })

    if (channelsRes.ok) setChannels((await channelsRes.json()) as DiscordChannel[])
    if (botRes.ok) setBotPerms(await botRes.json())

    if (brandingRes.ok) {
      const brandingData = (await brandingRes.json()) as BotBrandingResponse
      setBranding(brandingData)
      // Reset the editable branding fields to the live server state. On a
      // silent post-save reload this confirms the new values; on manual
      // refresh it discards unsaved branding edits (same as a fresh load).
      setBrandingNick(brandingData.current.nickname ?? '')
      setBrandingAvatar('')
    }
    setBrandingLoading(false)

    // Best-effort owner lookup. Falls back to the raw owner ID in the UI if
    // the bot can't see the member (e.g. lacking GUILD_MEMBERS intent).
    if (guildData.owner_id) {
      const ownerRes = await fetch(
        `/api/discord/guild/${guildId}/members/${guildData.owner_id}`,
        { cache: 'no-store' },
      ).catch(() => null)
      if (ownerRes && ownerRes.ok) {
        const member = (await ownerRes.json()) as {
          user: { id: string; username: string; global_name: string | null; avatar: string | null }
        }
        setOwner(member.user)
      }
    }

    setError(null)
    setLoading(false)
    setRefreshing(false)
  }, [guildId])

  const loadInvites = useCallback(async () => {
    setInvitesLoading(true)
    const res = await fetch(`/api/discord/guild/${guildId}/invites`, { cache: 'no-store' })
    if (res.ok) setInvites((await res.json()) as DiscordInvite[])
    setInvitesLoading(false)
  }, [guildId])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { loadInvites() }, [loadInvites])

  // Load Pulse assistant prefs: localStorage for the generation prefs, then the
  // DB embed_color (server-side source of truth) wins for the colour.
  useEffect(() => {
    let alive = true
    let base = DEFAULT_PULSE_PREFS
    try {
      const saved = localStorage.getItem(PULSE_PREFS_KEY(guildId))
      if (saved) base = { ...DEFAULT_PULSE_PREFS, ...(JSON.parse(saved) as PulsePrefs) }
    } catch {}
    getEmbedColor(guildId).then((color) => {
      if (!alive) return
      const merged = color ? { ...base, embedColor: color } : base
      setPulsePrefs(merged)
      setPulseSnapshot(merged)
    })
    return () => { alive = false }
  }, [guildId])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // ── Derived ───────────────────────────────────────────────────────────────

  // Treat unknown (null) as permitted; otherwise require Administrator on the
  // bot (Discord requires Manage Guild for the PATCH, which Administrator
  // implies). The dashboard already filters servers to ones the *user* manages.
  const botCanEdit = botPerms === null || botPerms.administrator

  const dirty = useMemo(() => {
    if (!initial || !edit) return false
    return Object.keys(diffEditState(initial, edit)).length > 0
  }, [initial, edit])

  const changes = useMemo(() => {
    if (!initial || !edit) return {}
    return diffEditState(initial, edit)
  }, [initial, edit])

  // Branding diff — folded into the same dirty/save flow as guild settings.
  const brandingNameDirty =
    !!branding && brandingNick.trim() !== (branding.current.nickname ?? '')
  const brandingAvatarDirty = brandingAvatar !== ''
  const brandingDirty = brandingNameDirty || brandingAvatarDirty
  const brandingChangeCount = (brandingNameDirty ? 1 : 0) + (brandingAvatarDirty ? 1 : 0)

  // Pulse assistant diff — also folded into the same Save bar.
  const pulseChangeCount = useMemo(() => {
    let n = 0
    for (const k of Object.keys(pulseSnapshot) as (keyof PulsePrefs)[]) {
      if (pulseSnapshot[k] !== pulsePrefs[k]) n += 1
    }
    return n
  }, [pulseSnapshot, pulsePrefs])
  const pulseDirty = pulseChangeCount > 0

  function updatePref<K extends keyof PulsePrefs>(key: K, value: PulsePrefs[K]) {
    setPulsePrefs((prev) => ({ ...prev, [key]: value }))
  }

  const textChannels = useMemo(
    () => channels
      .filter((c) => c.type === CHANNEL_TYPES.TEXT || c.type === CHANNEL_TYPES.ANNOUNCEMENT)
      .sort((a, b) => a.position - b.position),
    [channels],
  )
  const voiceChannels = useMemo(
    () => channels.filter((c) => c.type === CHANNEL_TYPES.VOICE).sort((a, b) => a.position - b.position),
    [channels],
  )

  // ── Editing ───────────────────────────────────────────────────────────────

  function patch<K extends keyof EditState>(key: K, value: EditState[K]) {
    setEdit((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  function resetEdits() {
    if (initial) setEdit(initial)
    if (branding) {
      setBrandingNick(branding.current.nickname ?? '')
      setBrandingAvatar('')
    }
    setPulsePrefs(pulseSnapshot)
  }

  function onPickIcon(file: File) {
    if (!file.type.startsWith('image/')) {
      setToast({ kind: 'err', text: 'Pick a PNG, JPEG, GIF, or WEBP image.' })
      return
    }
    // Discord rejects icons larger than 256 KiB after base64 encode. 200 KiB
    // raw is a safe ceiling.
    if (file.size > 200 * 1024) {
      setToast({ kind: 'err', text: 'Icon must be under 200 KB.' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (result) patch('iconDataUri', result)
    }
    reader.readAsDataURL(file)
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  async function doSave() {
    if (!initial || !edit) return
    setSaving(true)
    const failures: string[] = []

    // 1. Guild settings — only PATCH when something actually changed, so a
    //    branding-only save doesn't hit the route with an empty body.
    if (Object.keys(changes).length > 0) {
      const body: Record<string, unknown> = {}
      if (changes.name !== undefined) body.name = changes.name
      if (changes.iconDataUri !== undefined) body.icon = changes.iconDataUri
      if (changes.verification_level !== undefined) body.verification_level = changes.verification_level
      if (changes.default_message_notifications !== undefined) {
        body.default_message_notifications = changes.default_message_notifications
      }
      if (changes.explicit_content_filter !== undefined) {
        body.explicit_content_filter = changes.explicit_content_filter
      }
      if (changes.afk_channel_id !== undefined) body.afk_channel_id = changes.afk_channel_id
      if (changes.afk_timeout !== undefined) body.afk_timeout = changes.afk_timeout
      if (changes.system_channel_id !== undefined) body.system_channel_id = changes.system_channel_id
      if (changes.rules_channel_id !== undefined) body.rules_channel_id = changes.rules_channel_id
      if (changes.public_updates_channel_id !== undefined) {
        body.public_updates_channel_id = changes.public_updates_channel_id
      }
      body.reason = 'Updated from Pulsify dashboard'

      const res = await fetch(`/api/discord/guild/${guildId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        failures.push(data.error ?? 'Could not save server settings.')
      } else {
        const updated = (await res.json()) as DiscordGuildFull
        setGuild(updated)
        const fresh = buildEditState(updated)
        setInitial(fresh)
        setEdit(fresh)
      }
    }

    // 2. Bot branding — only PATCH the fields the admin touched.
    if (brandingDirty && branding) {
      const bbody: { nickname?: string | null; avatar?: string | null } = {}
      if (brandingNameDirty) bbody.nickname = brandingNick.trim() || null
      if (brandingAvatarDirty) bbody.avatar = brandingAvatar

      const res = await fetch(`/api/discord/guild/${guildId}/bot-branding`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bbody),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        failures.push(data.error ?? 'Could not save bot branding.')
      } else {
        const data = (await res.json()) as {
          current: { nickname: string | null; avatarUrl: string | null }
          lastUpdated: { at: string; by: string | null }
        }
        setBranding((prev) =>
          prev
            ? {
                ...prev,
                current: data.current,
                hasCustomBranding: Boolean(data.current.nickname || data.current.avatarUrl),
                lastUpdated: data.lastUpdated,
              }
            : prev,
        )
        setBrandingNick(data.current.nickname ?? '')
        setBrandingAvatar('')
      }
    }

    // 3. Pulse assistant — persist generation prefs to localStorage and the
    //    embed colour to guild_settings (the bot's source of truth).
    if (pulseDirty) {
      try {
        localStorage.setItem(PULSE_PREFS_KEY(guildId), JSON.stringify(pulsePrefs))
      } catch {}
      if (pulsePrefs.embedColor !== pulseSnapshot.embedColor) {
        const res = await saveEmbedColor(guildId, pulsePrefs.embedColor)
        if (!res.ok) failures.push(res.error)
      }
      if (!failures.length) setPulseSnapshot(pulsePrefs)
    }

    setSaving(false)

    if (failures.length > 0) {
      setError(failures.join(' '))
      setToast({ kind: 'err', text: failures[0] })
      return
    }
    setError(null)
    setToast({ kind: 'ok', text: 'Settings saved.' })
  }

  // ── Invites ───────────────────────────────────────────────────────────────

  async function handleDeleteInvite(code: string) {
    setPendingInviteCode(code)
    const res = await fetch(
      `/api/discord/guild/${guildId}/invites/${code}?reason=${encodeURIComponent('Revoked from Pulsify dashboard')}`,
      { method: 'DELETE' },
    )
    setPendingInviteCode(null)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast({ kind: 'err', text: data.error ?? 'Could not revoke invite.' })
      return
    }
    setInvites((prev) => prev.filter((i) => i.code !== code))
    setToast({ kind: 'ok', text: 'Invite revoked.' })
  }

  async function handleCreateInvite(values: Record<string, string>) {
    const channelId = values.channel_id
    if (!channelId) return
    const max_age = parseInt(values.max_age ?? '86400', 10)
    const max_uses = parseInt(values.max_uses ?? '0', 10)
    setCreatingInvite(true)
    const res = await fetch(`/api/discord/guild/${guildId}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_id: channelId,
        max_age: Number.isFinite(max_age) ? max_age : 86400,
        max_uses: Number.isFinite(max_uses) ? max_uses : 0,
        temporary: values.temporary === 'yes',
        unique: true,
        reason: 'Created from Pulsify dashboard',
      }),
    })
    setCreatingInvite(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast({ kind: 'err', text: data.error ?? 'Could not create invite.' })
      return
    }
    const created = (await res.json()) as DiscordInvite
    setInvites((prev) => [created, ...prev])
    setCreateInviteOpen(false)
    setToast({ kind: 'ok', text: `Invite created (${created.code}).` })
  }

  function copyInvite(code: string) {
    const url = `https://discord.gg/${code}`
    navigator.clipboard?.writeText(url).then(
      () => setToast({ kind: 'ok', text: 'Invite link copied.' }),
      () => setToast({ kind: 'err', text: 'Clipboard blocked.' }),
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="page-content">
        <PageHeader title="Server Settings" helpId="server-settings" description="Manage Discord server configuration." />
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!guild || !edit || !initial) {
    return (
      <div className="page-content">
        <PageHeader title="Server Settings" helpId="server-settings" description="Manage Discord server configuration." />
        <EmptyState
          icon={<AlertCircle size={32} />}
          title="Could not load server"
          description={error ?? 'The bot may not be installed on this server.'}
        />
      </div>
    )
  }

  const iconPreview =
    edit.iconDataUri && edit.iconDataUri !== ''
      ? edit.iconDataUri
      : edit.iconDataUri === null
        ? null
        : guildIconUrl(guild.id, guild.icon, 128) || null

  const memberCount = guild.approximate_member_count ?? guild.member_count ?? 0
  const boostTier = guild.premium_tier ?? 0
  const boostCount = guild.premium_subscription_count ?? 0

  const changedKeys = Object.keys(changes) as (keyof EditState)[]
  const isSensitive = (k: keyof EditState): boolean =>
    k === 'name' || k === 'verification_level' || k === 'explicit_content_filter' || k === 'iconDataUri'
  // Branding (name/avatar) is member-visible, so treat it as a sensitive change.
  const sensitiveChange = changedKeys.some(isSensitive) || brandingDirty
  const totalChangeCount = changedKeys.length + brandingChangeCount + pulseChangeCount

  return (
    <div className="page-content">
      <PageHeader
        title="Server Settings"
        helpId="server-settings"
        description={
          <>
            Manage <span className="font-medium text-foreground">{guild.name}</span> directly from the dashboard.
          </>
        }
        action={
          <button
            onClick={() => loadAll()}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      {!botCanEdit && (
        <div
          className="mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Bot is missing Manage Server.</p>
            <p className="mt-0.5 text-xs opacity-90">
              Server settings are read-only until the Pulsify bot role gets Administrator (or Manage Guild) on this server.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
        >
          <AlertCircle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {toast && (
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: toast.kind === 'ok' ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)',
            background:  toast.kind === 'ok' ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            color:       toast.kind === 'ok' ? '#10b981' : '#f87171',
          }}
        >
          {toast.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {toast.text}
        </div>
      )}

      <div className="space-y-8">
        {/* ── Server Information ───────────────────────────────────────── */}
        <CategorySection
          icon={<Server size={14} />}
          title="Server Information"
          description="Live snapshot from Discord — these fields are read-only here."
        >
          <SectionCard title="Profile" description="Identity and high-level stats for this server.">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="relative">
                {iconPreview ? (
                  <Image
                    src={iconPreview}
                    alt={guild.name}
                    width={84}
                    height={84}
                    className="rounded-2xl"
                    unoptimized
                  />
                ) : (
                  <div
                    className="flex h-[84px] w-[84px] items-center justify-center rounded-2xl text-2xl font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
                  >
                    {guild.name.charAt(0)}
                  </div>
                )}
              </div>
              <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
                <InfoStat icon={<Users size={14} />} label="Members" value={memberCount.toLocaleString()} />
                <InfoStat
                  icon={<Crown size={14} />}
                  label="Owner"
                  value={owner?.global_name ?? owner?.username ?? guild.owner_id.slice(0, 6) + '…'}
                />
                <InfoStat
                  icon={<Sparkles size={14} />}
                  label="Boost Tier"
                  value={`Tier ${boostTier}`}
                  sub={`${boostCount} boost${boostCount === 1 ? '' : 's'}`}
                />
                <InfoStat
                  icon={<ShieldCheck size={14} />}
                  label="Verification"
                  value={VERIFICATION_OPTIONS[guild.verification_level ?? 0]?.label ?? '—'}
                />
              </div>
            </div>
          </SectionCard>
        </CategorySection>

        {/* ── Identity ─────────────────────────────────────────────────── */}
        <CategorySection
          icon={<Hash size={14} />}
          title="Identity"
          description="Server name and icon shown across Discord."
        >
          <SectionCard title="Server Name" description="Visible at the top of the channel list. 2–100 characters.">
            <input
              type="text"
              value={edit.name}
              onChange={(e) => patch('name', e.target.value)}
              maxLength={100}
              disabled={!botCanEdit}
              className="w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors disabled:opacity-50"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
            />
            <p className="mt-2 text-xs" style={{ color: 'var(--text-3)' }}>
              {edit.name.length} / 100 characters
            </p>
          </SectionCard>

          <SectionCard title="Server Icon" description="PNG, JPEG, GIF, or WEBP. Max 200 KB.">
            <div className="flex items-center gap-4">
              <div className="relative">
                {iconPreview ? (
                  <Image
                    src={iconPreview}
                    alt="Server icon preview"
                    width={72}
                    height={72}
                    className="rounded-xl border"
                    style={{ borderColor: 'var(--line-strong)' }}
                    unoptimized
                  />
                ) : (
                  <div
                    className="flex h-[72px] w-[72px] items-center justify-center rounded-xl border text-xl font-bold text-white"
                    style={{
                      background: 'linear-gradient(135deg, var(--p-1), var(--p-2))',
                      borderColor: 'var(--line-strong)',
                    }}
                  >
                    {guild.name.charAt(0)}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) onPickIcon(file)
                    e.target.value = ''
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!botCanEdit}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
                    style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                  >
                    <Upload size={12} />
                    Upload new icon
                  </button>
                  {(guild.icon || edit.iconDataUri) && edit.iconDataUri !== null && (
                    <button
                      type="button"
                      onClick={() => patch('iconDataUri', null)}
                      disabled={!botCanEdit}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
                      style={{
                        borderColor: 'rgba(239,68,68,0.35)',
                        background: 'rgba(239,68,68,0.06)',
                        color: '#f87171',
                      }}
                    >
                      <X size={12} />
                      Remove
                    </button>
                  )}
                  {edit.iconDataUri !== '' && (
                    <button
                      type="button"
                      onClick={() => patch('iconDataUri', '')}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition"
                      style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
                    >
                      <RotateCcw size={12} />
                      Undo icon change
                    </button>
                  )}
                </div>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Animated icons require boost level 1 or higher.
                </p>
              </div>
            </div>
          </SectionCard>

          <BotBrandingCard
            loading={brandingLoading}
            branding={branding}
            nickname={brandingNick}
            onNicknameChange={setBrandingNick}
            avatar={brandingAvatar}
            onAvatarChange={setBrandingAvatar}
            onNotice={(kind, text) => setToast({ kind, text })}
            error={error}
          />
        </CategorySection>

        {/* ── Pulse Assistant ──────────────────────────────────────────── */}
        {/* Moved here from the old Automations settings. The embed colour is the
            single source of truth applied to every Pulse embed on Discord. */}
        <PulseAssistantSections prefs={pulsePrefs} updatePref={updatePref} />

        {/* ── Safety ───────────────────────────────────────────────────── */}
        <CategorySection
          icon={<Shield size={14} />}
          title="Safety & Moderation Defaults"
          description="Verification gate, default notifications, and content filtering."
        >
          <SectionCard title="Verification Level" description="How much friction new members face before they can talk.">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
              {VERIFICATION_OPTIONS.map((opt) => {
                const active = edit.verification_level === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => patch('verification_level', opt.value)}
                    disabled={!botCanEdit}
                    className="relative flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition-all disabled:opacity-50"
                    style={{
                      background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                      borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                    }}
                  >
                    <span className="text-sm font-semibold" style={{ color: active ? 'var(--p-1)' : 'var(--text)' }}>
                      {opt.label}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                      {opt.sub}
                    </span>
                  </button>
                )
              })}
            </div>
          </SectionCard>

          <div className="grid gap-4 md:grid-cols-2">
            <SectionCard title="Default Notifications" description="What new members start with — they can override personally.">
              <div className="space-y-2">
                {NOTIFICATION_OPTIONS.map((opt) => {
                  const active = edit.default_message_notifications === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => patch('default_message_notifications', opt.value)}
                      disabled={!botCanEdit}
                      className="relative flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all disabled:opacity-50"
                      style={{
                        background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                        borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                      }}
                    >
                      <span style={{ color: active ? 'var(--p-1)' : 'var(--text-3)' }}>
                        <Bell size={16} />
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-foreground">{opt.label}</p>
                        <p className="text-xs" style={{ color: 'var(--text-3)' }}>{opt.sub}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </SectionCard>

            <SectionCard title="Explicit Content Filter" description="Scans uploaded media in messages.">
              <div className="space-y-2">
                {EXPLICIT_FILTER_OPTIONS.map((opt) => {
                  const active = edit.explicit_content_filter === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => patch('explicit_content_filter', opt.value)}
                      disabled={!botCanEdit}
                      className="relative flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all disabled:opacity-50"
                      style={{
                        background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                        borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                      }}
                    >
                      <span style={{ color: active ? 'var(--p-1)' : 'var(--text-3)' }}>
                        <Filter size={16} />
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-foreground">{opt.label}</p>
                        <p className="text-xs" style={{ color: 'var(--text-3)' }}>{opt.sub}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </SectionCard>
          </div>
        </CategorySection>

        {/* ── Channel routing ──────────────────────────────────────────── */}
        <CategorySection
          icon={<Hash size={14} />}
          title="Channel Routing"
          description="Where Discord sends system messages, rules, and AFK members."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <ChannelSelectCard
              title="AFK Channel"
              description="Idle voice members are moved here after the AFK timeout."
              icon={<Volume2 size={14} />}
              channels={voiceChannels}
              value={edit.afk_channel_id}
              onChange={(v) => patch('afk_channel_id', v)}
              disabled={!botCanEdit}
              extra={
                <div className="mt-3">
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                    AFK timeout
                  </label>
                  <select
                    value={edit.afk_timeout}
                    onChange={(e) => patch('afk_timeout', parseInt(e.target.value, 10))}
                    disabled={!botCanEdit || !edit.afk_channel_id}
                    className="w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                    style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                  >
                    {AFK_TIMEOUT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              }
            />

            <ChannelSelectCard
              title="System Messages Channel"
              description="Where Discord posts join messages, boost alerts, and pin announcements."
              icon={<MessageSquare size={14} />}
              channels={textChannels}
              value={edit.system_channel_id}
              onChange={(v) => patch('system_channel_id', v)}
              disabled={!botCanEdit}
            />

            <ChannelSelectCard
              title="Rules Channel"
              description="Read-only channel new members see before they can chat (Community only)."
              icon={<BookOpen size={14} />}
              channels={textChannels}
              value={edit.rules_channel_id}
              onChange={(v) => patch('rules_channel_id', v)}
              disabled={!botCanEdit}
            />

            <ChannelSelectCard
              title="Community Updates Channel"
              description="Where Discord sends safety alerts for community servers."
              icon={<Megaphone size={14} />}
              channels={textChannels}
              value={edit.public_updates_channel_id}
              onChange={(v) => patch('public_updates_channel_id', v)}
              disabled={!botCanEdit}
            />
          </div>
        </CategorySection>

        {/* ── Bot permissions overview ─────────────────────────────────── */}
        <CategorySection
          icon={<ShieldCheck size={14} />}
          title="Bot Permission Status"
          description="What the Pulsify bot can currently do on this server."
        >
          <SectionCard title="Effective Permissions" description="Computed from the bot's role assignments. Discord enforces these — Pulsify only reflects them.">
            {botPerms === null ? (
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                Could not determine bot permissions. The bot may not be in this server, or Discord blocked the lookup.
              </p>
            ) : !botPerms.inGuild ? (
              <p className="text-sm" style={{ color: '#f87171' }}>
                The Pulsify bot is not currently a member of this server.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {[
                  { label: 'Administrator',   ok: botPerms.administrator },
                  { label: 'Manage Channels', ok: botPerms.manageChannels },
                  { label: 'Manage Roles',    ok: botPerms.manageRoles },
                  { label: 'Manage Messages', ok: botPerms.manageMessages },
                  { label: 'Ban Members',     ok: botPerms.banMembers },
                  { label: 'Kick Members',    ok: botPerms.kickMembers },
                  { label: 'Timeout Members', ok: botPerms.moderateMembers },
                  { label: 'Manage Nicknames',ok: botPerms.manageNicknames },
                  { label: 'View Audit Log',  ok: botPerms.viewAuditLog },
                  { label: 'Send Messages',   ok: botPerms.sendMessages },
                ].map((p) => (
                  <div
                    key={p.label}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
                    style={{
                      background: 'var(--bg-2)',
                      borderColor: 'var(--line-strong)',
                    }}
                  >
                    {p.ok ? (
                      <CheckCircle2 size={13} style={{ color: '#10b981' }} />
                    ) : (
                      <CircleSlash size={13} style={{ color: '#f87171' }} />
                    )}
                    <span style={{ color: p.ok ? 'var(--text)' : 'var(--text-3)' }}>{p.label}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </CategorySection>

        {/* ── Invites ──────────────────────────────────────────────────── */}
        <CategorySection
          icon={<Link2 size={14} />}
          title="Server Invites"
          description="Active invite links pointing at this server."
        >
          <SectionCard
            title="Active Invites"
            description="Created, copied, and revoked links to this server."
            footer={
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {invitesLoading ? 'Loading invites…' : `${invites.length} active invite${invites.length === 1 ? '' : 's'}`}
                </p>
                <button
                  type="button"
                  onClick={() => setCreateInviteOpen(true)}
                  disabled={textChannels.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-50"
                  style={{ background: 'var(--p-1)' }}
                >
                  <Plus size={12} />
                  New invite
                </button>
              </div>
            }
          >
            {invitesLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={18} className="animate-spin text-muted-foreground" />
              </div>
            ) : invites.length === 0 ? (
              <EmptyState
                icon={<Link2 size={28} />}
                title="No invites yet"
                description="Create one to share a link to this server."
              />
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--line-strong)' }}>
                {invites.map((inv) => {
                  const url = `https://discord.gg/${inv.code}`
                  const expires = inv.expires_at
                    ? new Date(inv.expires_at).toLocaleString()
                    : 'Never expires'
                  const usesLabel = inv.max_uses === 0
                    ? `${inv.uses} uses`
                    : `${inv.uses} / ${inv.max_uses} uses`
                  return (
                    <li
                      key={inv.code}
                      className="flex items-center justify-between gap-3 py-3"
                      style={{ borderColor: 'var(--line-strong)' }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-foreground">{url}</span>
                          {inv.temporary && (
                            <span
                              className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                              style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
                            >
                              Temporary
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
                          {inv.channel ? `→ #${inv.channel.name}` : '→ Unknown channel'}
                          {' · '}{usesLabel}{' · '}{expires}
                          {inv.inviter && (
                            <> · by {inv.inviter.global_name ?? inv.inviter.username}</>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => copyInvite(inv.code)}
                          title="Copy invite link"
                          className="rounded-md p-1.5 transition"
                          style={{ color: 'var(--text-3)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteInvite(inv.code)}
                          disabled={pendingInviteCode === inv.code}
                          title="Revoke invite"
                          className="rounded-md p-1.5 transition disabled:opacity-50"
                          style={{ color: '#f87171' }}
                        >
                          {pendingInviteCode === inv.code
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Trash2 size={14} />}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </SectionCard>
        </CategorySection>
      </div>

      <SaveBar
        dirty={dirty || brandingDirty || pulseDirty}
        changedCount={totalChangeCount}
        saving={saving}
        // Guild inputs are already disabled when the bot can't edit, so the only
        // changes possible then are branding or Pulse prefs — keep Save reachable.
        disabled={!botCanEdit && !brandingDirty && !pulseDirty}
        saveLabel="Save Settings"
        cleanText="All changes saved. Edits sync to Discord on save."
        dirtyHintText="review and save to sync with Discord."
        confirmTitle="Apply server settings?"
        confirmDescription={
          sensitiveChange
            ? 'You’re changing settings that are visible to every member (which may include the bot’s name or avatar). This action syncs immediately with Discord.'
            : 'These changes will sync immediately with Discord.'
        }
        confirmLabel="Sync to Discord"
        confirmTone={sensitiveChange ? 'warning' : 'default'}
        onReset={resetEdits}
        onSave={doSave}
      />

      {/* ── Create invite ───────────────────────────────────────────────── */}
      {createInviteOpen && (
        <ConfirmDialog
          title="Create invite link"
          description="Generates a new invite to this server."
          confirmLabel={creatingInvite ? 'Creating…' : 'Create invite'}
          tone="default"
          busy={creatingInvite}
          onCancel={() => { if (!creatingInvite) setCreateInviteOpen(false) }}
          onConfirm={(values) => handleCreateInvite(values)}
          fields={[
            {
              key: 'channel_id',
              kind: 'select',
              label: 'Channel',
              options: textChannels.map((c) => ({ value: c.id, label: `#${c.name}` })),
              defaultValue: textChannels[0]?.id,
            },
            {
              key: 'max_age',
              kind: 'select',
              label: 'Expires after',
              options: [
                { value: '1800',   label: '30 minutes' },
                { value: '3600',   label: '1 hour' },
                { value: '21600',  label: '6 hours' },
                { value: '43200',  label: '12 hours' },
                { value: '86400',  label: '1 day' },
                { value: '604800', label: '7 days' },
                { value: '0',      label: 'Never' },
              ],
              defaultValue: '86400',
            },
            {
              key: 'max_uses',
              kind: 'select',
              label: 'Max uses',
              options: [
                { value: '0',   label: 'No limit' },
                { value: '1',   label: '1 use' },
                { value: '5',   label: '5 uses' },
                { value: '10',  label: '10 uses' },
                { value: '25',  label: '25 uses' },
                { value: '50',  label: '50 uses' },
                { value: '100', label: '100 uses' },
              ],
              defaultValue: '0',
            },
            {
              key: 'temporary',
              kind: 'select',
              label: 'Grant temporary membership',
              options: [
                { value: 'no',  label: 'No — full membership' },
                { value: 'yes', label: 'Yes — kicked when offline if unroled' },
              ],
              defaultValue: 'no',
            },
          ]}
        />
      )}
    </div>
  )
}

// ─── Local sub-components ────────────────────────────────────────────────────

function InfoStat({
  icon, label, value, sub,
}: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div
      className="rounded-xl border px-3 py-2.5"
      style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
    >
      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
        {icon}
        {label}
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
      {sub && <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

function ChannelSelectCard({
  title, description, icon, channels, value, onChange, disabled, extra,
}: {
  title: string
  description: string
  icon: React.ReactNode
  channels: DiscordChannel[]
  value: string | null
  onChange: (v: string | null) => void
  disabled?: boolean
  extra?: React.ReactNode
}) {
  return (
    <SectionCard title={title} description={description}>
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
        >
          {icon}
        </span>
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          className="flex-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
          style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
        >
          <option value="">None</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>#{c.name}</option>
          ))}
        </select>
      </div>
      {extra}
    </SectionCard>
  )
}
