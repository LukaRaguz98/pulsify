'use client'

import { useState, useTransition } from 'react'
import { saveAutomations } from './actions'
import type { DiscordChannel, DiscordRole } from '@/lib/discord'
import { Zap, MessageSquare, Star, Bell, CheckCircle } from 'lucide-react'

type Props = {
  guildId: string
  channels: DiscordChannel[]
  roles: DiscordRole[]
  initialSettings: Record<string, unknown>
}

type WelcomeConfig = { enabled: boolean; channel_id: string; message: string }
type AutoRoleConfig = { enabled: boolean; role_id: string }
type ModerationAlertsConfig = { enabled: boolean; channel_id: string }

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
      style={{
        background: enabled ? 'linear-gradient(90deg, var(--p-1), var(--p-2))' : 'var(--bg-2)',
        boxShadow: enabled ? '0 0 12px -2px var(--p-glow)' : 'none',
      }}
    >
      <span
        className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow"
        style={{ transform: enabled ? 'translateX(24px)' : 'translateX(4px)' }}
      />
    </button>
  )
}

const selectClass = `
  w-full rounded-lg border px-3 py-2 text-sm text-foreground focus:outline-none transition
  bg-[var(--bg-2)] border-[var(--line-strong)] focus:border-[var(--p-1)]
`

export function AutomationsForm({ guildId, channels, roles, initialSettings }: Props) {
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  const rawWelcome = initialSettings.welcome as Partial<WelcomeConfig> | undefined
  const rawAutoRole = initialSettings.auto_role as Partial<AutoRoleConfig> | undefined
  const rawModAlerts = initialSettings.moderation_alerts as Partial<ModerationAlertsConfig> | undefined

  const [welcome, setWelcome] = useState<WelcomeConfig>({
    enabled: rawWelcome?.enabled ?? false,
    channel_id: rawWelcome?.channel_id ?? '',
    message: rawWelcome?.message ?? 'Welcome to {server}, {user}! 🎉',
  })

  const [autoRole, setAutoRole] = useState<AutoRoleConfig>({
    enabled: rawAutoRole?.enabled ?? false,
    role_id: rawAutoRole?.role_id ?? '',
  })

  const [modAlerts, setModAlerts] = useState<ModerationAlertsConfig>({
    enabled: rawModAlerts?.enabled ?? false,
    channel_id: rawModAlerts?.channel_id ?? '',
  })

  function handleSave() {
    startTransition(async () => {
      await saveAutomations(guildId, { welcome, auto_role: autoRole, moderation_alerts: modAlerts })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    })
  }

  const cards = [
    {
      icon: <MessageSquare size={16} />,
      iconBg: 'rgba(59,130,246,0.12)',
      iconColor: '#3b82f6',
      title: 'Welcome Message',
      description: 'Send a message when a new member joins.',
      enabled: welcome.enabled,
      onToggle: (v: boolean) => setWelcome({ ...welcome, enabled: v }),
      extra: welcome.enabled && (
        <div className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Welcome Channel</label>
            <select
              value={welcome.channel_id}
              onChange={(e) => setWelcome({ ...welcome, channel_id: e.target.value })}
              className={selectClass}
            >
              <option value="">Select a channel</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>#{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Message <span className="text-subtle">({'{user}'} = mention, {'{server}'} = server name)</span>
            </label>
            <textarea
              value={welcome.message}
              onChange={(e) => setWelcome({ ...welcome, message: e.target.value })}
              rows={3}
              className={selectClass + ' resize-none'}
            />
          </div>
        </div>
      ),
    },
    {
      icon: <Star size={16} />,
      iconBg: 'rgba(16,185,129,0.12)',
      iconColor: '#10b981',
      title: 'Auto-Role',
      description: 'Automatically assign a role to new members.',
      enabled: autoRole.enabled,
      onToggle: (v: boolean) => setAutoRole({ ...autoRole, enabled: v }),
      extra: autoRole.enabled && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--line-strong)' }}>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Role to assign</label>
          <select
            value={autoRole.role_id}
            onChange={(e) => setAutoRole({ ...autoRole, role_id: e.target.value })}
            className={selectClass}
          >
            <option value="">Select a role</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      ),
    },
    {
      icon: <Bell size={16} />,
      iconBg: 'rgba(245,158,11,0.12)',
      iconColor: '#f59e0b',
      title: 'Moderation Alerts',
      description: 'Get notified when moderation actions occur.',
      enabled: modAlerts.enabled,
      onToggle: (v: boolean) => setModAlerts({ ...modAlerts, enabled: v }),
      extra: modAlerts.enabled && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--line-strong)' }}>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Alert Channel</label>
          <select
            value={modAlerts.channel_id}
            onChange={(e) => setModAlerts({ ...modAlerts, channel_id: e.target.value })}
            className={selectClass}
          >
            <option value="">Select a channel</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </select>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {cards.map((card) => (
        <div
          key={card.title}
          className="rounded-xl border p-5"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ background: card.iconBg, color: card.iconColor }}
              >
                {card.icon}
              </div>
              <div>
                <h2 className="font-semibold text-foreground">{card.title}</h2>
                <p className="text-sm text-subtle">{card.description}</p>
              </div>
            </div>
            <Toggle enabled={card.enabled} onChange={card.onToggle} />
          </div>
          {card.extra}
        </div>
      ))}

      <div className="flex items-center gap-4 pt-2">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
          style={{
            background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
            boxShadow: '0 4px 14px -4px var(--p-glow)',
          }}
        >
          <Zap size={15} />
          {isPending ? 'Saving…' : 'Save Automations'}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm" style={{ color: '#10b981' }}>
            <CheckCircle size={15} />
            Saved successfully!
          </span>
        )}
      </div>
    </div>
  )
}
