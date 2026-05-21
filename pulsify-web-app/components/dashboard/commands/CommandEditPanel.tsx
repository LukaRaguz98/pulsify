'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  Loader2,
  Save,
  Power,
  Wrench,
  EyeOff,
  Eye,
  Tag,
  ShieldCheck,
  Clock,
  Gauge,
  Plus,
  Check,
  AlertTriangle,
  Hash,
  Copy,
  Sparkles,
} from 'lucide-react'
import type { DiscordRole, DiscordChannel } from '@/lib/discord'
import { roleColor } from '@/lib/discord'
import {
  CATEGORY_META,
  PERMISSION_META,
  PERMISSION_LEVEL_OPTIONS,
  effectivePermission,
  type CommandDefinition,
  type CommandConfig,
  type CommandCategory,
  type ConfigPermissionLevel,
} from '@/lib/commands'
import { saveCommandConfig } from '@/app/dashboard/[guildId]/commands/actions'
import { PermissionBadge } from './badges'

type Props = {
  guildId: string
  definition: CommandDefinition
  config: CommandConfig
  roles: DiscordRole[]
  channels: DiscordChannel[]
  onClose: () => void
  onSaved: (commandName: string, config: CommandConfig) => void
}

const INHERIT_CATEGORY = '__inherit__'
const CATEGORY_VALUES: CommandCategory[] = ['utility', 'information', 'insights', 'moderation']

export function CommandEditPanel({
  guildId,
  definition,
  config,
  roles,
  channels,
  onClose,
  onSaved,
}: Props) {
  const [draft, setDraft] = useState<CommandConfig>(config)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Reset when a different command is opened.
  useEffect(() => {
    setDraft(config)
    setError(null)
    setSuccess(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition.name])

  // Hide the corner decoration behind the slide-over (same trick as RoleEditPanel).
  useEffect(() => {
    document.body.classList.add('slide-over-open')
    return () => document.body.classList.remove('slide-over-open')
  }, [])

  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => setSuccess(null), 3000)
    return () => clearTimeout(t)
  }, [success])

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(config),
    [draft, config],
  )

  function patch(p: Partial<CommandConfig>) {
    setDraft((d) => ({ ...d, ...p }))
  }

  async function save() {
    setBusy(true)
    setError(null)
    setSuccess(null)
    const res = await saveCommandConfig(guildId, definition.name, draft)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSuccess('Saved.')
    onSaved(definition.name, draft)
  }

  const channelItems = channels.map((c) => ({ id: c.id, label: `#${c.name}` }))
  const roleItems = roles.map((r) => ({
    id: r.id,
    label: r.name,
    color: r.color === 0 ? undefined : roleColor(r.color),
  }))

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        onClick={() => !busy && onClose()}
      />

      <aside
        role="dialog"
        aria-label={`Configure /${definition.name}`}
        className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[640px] flex-col border-l shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <header
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: 'var(--line-strong)' }}
        >
          <div className="min-w-0">
            <h2 className="truncate font-mono font-semibold text-foreground">
              /{definition.name}
            </h2>
            <p className="truncate text-xs text-subtle">{definition.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <Banner tone="error">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </Banner>
          )}
          {success && (
            <Banner tone="success">
              <Check size={12} className="mt-0.5 shrink-0" />
              <span>{success}</span>
            </Banner>
          )}

          {/* Availability */}
          <Section icon={<Power size={13} />} label="Availability" description="Control whether this command runs in your server.">
            <Toggle
              label="Command enabled"
              description="When off, the command is removed from Discord and won't respond."
              checked={draft.enabled}
              disabled={busy}
              onChange={(v) => patch({ enabled: v })}
            />
            <Toggle
              icon={<Wrench size={13} />}
              label="Maintenance mode"
              description="Temporarily pause the command for everyone without losing its config."
              checked={draft.maintenance}
              disabled={busy}
              onChange={(v) => patch({ maintenance: v })}
            />
            <Toggle
              icon={<EyeOff size={13} />}
              label="Hide from /help"
              description="The command still works for those allowed, but isn't listed in /help."
              checked={draft.hidden}
              disabled={busy}
              onChange={(v) => patch({ hidden: v })}
            />
            <Toggle
              icon={<Eye size={13} />}
              label="Public response"
              description="When on, the reply is posted in the channel for everyone to see. Off keeps it visible only to the member who ran the command."
              checked={!draft.ephemeral}
              disabled={busy}
              onChange={(v) => patch({ ephemeral: !v })}
            />
          </Section>

          {/* Category */}
          <Section icon={<Tag size={13} />} label="Category" description="How the command is grouped in the dashboard and /help.">
            <select
              value={draft.category ?? INHERIT_CATEGORY}
              disabled={busy}
              onChange={(e) =>
                patch({
                  category:
                    e.target.value === INHERIT_CATEGORY
                      ? null
                      : (e.target.value as CommandCategory),
                })
              }
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={fieldStyle}
            >
              <option value={INHERIT_CATEGORY}>
                Default · {CATEGORY_META[definition.category].label}
              </option>
              {CATEGORY_VALUES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_META[c].label}
                </option>
              ))}
            </select>
          </Section>

          {/* Permissions */}
          <Section
            icon={<ShieldCheck size={13} />}
            label="Permissions"
            description="Who is allowed to run the command. Deny lists always win over allow lists."
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Access level</span>
              <span className="flex items-center gap-1.5 text-[11px] text-subtle">
                Effective:
                <PermissionBadge level={effectivePermission(definition, draft)} />
              </span>
            </div>
            <select
              value={draft.permission_level}
              disabled={busy}
              onChange={(e) => patch({ permission_level: e.target.value as ConfigPermissionLevel })}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={fieldStyle}
            >
              {PERMISSION_LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value === 'inherit'
                    ? `Default · ${PERMISSION_META[definition.defaultPermission].label}`
                    : o.label}
                </option>
              ))}
            </select>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TokenSelect
                title="Allowed roles"
                hint="Only these roles may run it."
                items={roleItems}
                selected={draft.allowed_role_ids}
                disabled={busy}
                onChange={(ids) => patch({ allowed_role_ids: ids })}
              />
              <TokenSelect
                title="Denied roles"
                hint="These roles can never run it."
                items={roleItems}
                selected={draft.denied_role_ids}
                disabled={busy}
                onChange={(ids) => patch({ denied_role_ids: ids })}
              />
              <TokenSelect
                title="Allowed channels"
                hint="Only usable in these channels."
                items={channelItems}
                selected={draft.allowed_channel_ids}
                disabled={busy}
                icon={<Hash size={11} />}
                onChange={(ids) => patch({ allowed_channel_ids: ids })}
              />
              <TokenSelect
                title="Denied channels"
                hint="Blocked in these channels."
                items={channelItems}
                selected={draft.denied_channel_ids}
                disabled={busy}
                icon={<Hash size={11} />}
                onChange={(ids) => patch({ denied_channel_ids: ids })}
              />
            </div>
          </Section>

          {/* Restrictions */}
          <Section icon={<Gauge size={13} />} label="Limits" description="Throttle how often the command can be used.">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                icon={<Clock size={12} />}
                label="Cooldown (seconds)"
                hint="Per-user wait between uses. 0 = none."
                value={draft.cooldown_seconds}
                min={0}
                max={86_400}
                disabled={busy}
                onChange={(v) => patch({ cooldown_seconds: v })}
              />
              <NumberField
                icon={<Gauge size={12} />}
                label="Daily usage limit"
                hint="Max successful runs per day, server-wide. 0 = unlimited."
                value={draft.usage_limit_per_day}
                min={0}
                max={100_000}
                disabled={busy}
                onChange={(v) => patch({ usage_limit_per_day: v })}
              />
            </div>
          </Section>

          {/* Preview + quick test */}
          <Section icon={<Sparkles size={13} />} label="Examples & quick test" description="Copy an example to paste straight into Discord.">
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{definition.detail}</p>
            {definition.options && definition.options.length > 0 && (
              <div className="mb-3 space-y-1.5">
                {definition.options.map((opt) => (
                  <div key={opt.name} className="flex items-baseline gap-2 text-xs">
                    <code
                      className="rounded px-1.5 py-0.5 font-mono"
                      style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                    >
                      {opt.name}
                      {opt.required ? '*' : ''}
                    </code>
                    <span className="text-subtle">{opt.description}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              {definition.examples.map((ex) => (
                <ExampleRow key={ex} example={ex} />
              ))}
            </div>
          </Section>
        </div>

        <footer
          className="flex items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50"
            style={{
              background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
              boxShadow: '0 4px 14px -4px var(--p-glow)',
            }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      </aside>
    </>
  )
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

function Banner({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  const styles =
    tone === 'error'
      ? { borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }
      : { borderColor: 'rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.08)', color: '#4ade80' }
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={styles}>
      {children}
    </div>
  )
}

function Section({
  icon,
  label,
  description,
  children,
}: {
  icon: React.ReactNode
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-2)' }}>
            {label}
          </h3>
          {description && <p className="text-xs text-subtle">{description}</p>}
        </div>
        <div className="ml-1 h-px flex-1" style={{ background: 'var(--line-strong)' }} />
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Toggle({
  icon,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon?: React.ReactNode
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2"
      style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', opacity: disabled ? 0.6 : 1 }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[var(--p-1)]"
      />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          {icon && <span style={{ color: 'var(--text-3)' }}>{icon}</span>}
          {label}
        </p>
        {description && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
        )}
      </div>
    </label>
  )
}

function NumberField({
  icon,
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  icon?: React.ReactNode
  label: string
  hint?: string
  value: number
  min: number
  max: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon && <span style={{ color: 'var(--text-3)' }}>{icon}</span>}
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const n = Math.floor(Number(e.target.value))
          onChange(Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min)
        }}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
        style={fieldStyle}
      />
      {hint && <p className="mt-1 text-[11px] text-subtle">{hint}</p>}
    </div>
  )
}

type Token = { id: string; label: string; color?: string }

function TokenSelect({
  title,
  hint,
  items,
  selected,
  disabled,
  icon,
  onChange,
}: {
  title: string
  hint?: string
  items: Token[]
  selected: string[]
  disabled?: boolean
  icon?: React.ReactNode
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const available = items.filter((i) => !selected.includes(i.id))

  function add(id: string) {
    onChange([...selected, id])
  }
  function remove(id: string) {
    onChange(selected.filter((s) => s !== id))
  }

  return (
    <div ref={ref}>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</p>
      <div
        className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border p-1.5"
        style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
      >
        {selected.length === 0 && (
          <span className="px-1 text-[11px] text-subtle">{hint ?? 'None'}</span>
        )}
        {selected.map((id) => {
          const item = byId.get(id)
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              {item?.color && (
                <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
              )}
              {icon && !item?.color && <span style={{ color: 'var(--text-3)' }}>{icon}</span>}
              <span className="max-w-[110px] truncate">{item?.label ?? id}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(id)}
                  className="text-subtle transition hover:text-foreground"
                  aria-label={`Remove ${item?.label ?? id}`}
                >
                  <X size={11} />
                </button>
              )}
            </span>
          )
        })}
        {!disabled && available.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition hover:bg-[var(--panel)]"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
            >
              <Plus size={11} />
              Add
            </button>
            {open && (
              <div
                className="absolute left-0 z-30 mt-1 max-h-52 w-56 overflow-y-auto rounded-lg border py-1 shadow-xl"
                style={{ background: 'var(--panel-2)', borderColor: 'var(--line-strong)' }}
              >
                {available.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => {
                      add(i.id)
                      if (available.length === 1) setOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-[var(--bg-2)]"
                    style={{ color: 'var(--text)' }}
                  >
                    {i.color ? (
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: i.color }} />
                    ) : (
                      icon && <span style={{ color: 'var(--text-3)' }}>{icon}</span>
                    )}
                    <span className="truncate">{i.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ExampleRow({ example }: { example: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(example)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — no-op */
    }
  }
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
      style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
    >
      <code className="truncate font-mono text-xs" style={{ color: 'var(--text-2)' }}>
        {example}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition hover:bg-[var(--panel)]"
        style={{ borderColor: 'var(--line-strong)', color: copied ? '#22c55e' : 'var(--text-3)' }}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
