'use client'

import {
  Hand, ShieldCheck, Tags, CalendarDays, Compass, Gift,
  Bell, Heart, Languages, Rss, DoorOpen,
  BookOpen, LifeBuoy, MessageSquare, Lightbulb, Megaphone, Sparkles,
  ArrowUp, ArrowDown, Plus, Trash2, GripVertical, Link2, Image as ImageIcon,
  TrendingUp, Users, CheckCircle2, ShieldCheck as ShieldIcon, type LucideIcon,
} from 'lucide-react'
import {
  ONBOARDING_STEP_META, ROLE_CATEGORY_META, ROLE_CATEGORY_ORDER,
  COMMUNITY_LINK_META, COMMUNITY_LINK_ORDER,
  type MemberOnboardingConfig, type OnboardingStepId, type RoleCategory,
  type RoleCategoryId, type CommunityLinkKey, type OnboardingStats,
} from '@/lib/onboarding'
import {
  Labeled, TextInput, TextArea, NumberInput, ChannelSelect, RoleSelect,
  RoleMultiSelect, Toggle, SubCard, DisabledHint, AccentColorPicker,
  type ChannelOpt, type RoleOpt, type EventOpt,
} from './parts'

const ICONS: Record<string, LucideIcon> = {
  Hand, ShieldCheck, Tags, CalendarDays, Compass, Gift,
  Bell, Heart, Languages, Rss, DoorOpen,
  BookOpen, LifeBuoy, MessageSquare, Lightbulb, Megaphone, Sparkles,
}
function Icon({ name, size = 15 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? Hand
  return <C size={size} />
}

export type SectionProps = {
  config: MemberOnboardingConfig
  patch: (p: Partial<MemberOnboardingConfig>) => void
  channels: ChannelOpt[]
  roles: RoleOpt[]
  events: EventOpt[]
  guildName: string
}

// ── Flow ────────────────────────────────────────────────────────────────────

export function FlowSection({ config, patch, channels }: SectionProps) {
  function move(idx: number, dir: -1 | 1) {
    const steps = [...config.steps]
    const j = idx + dir
    if (j < 0 || j >= steps.length) return
    ;[steps[idx], steps[j]] = [steps[j], steps[idx]]
    patch({ steps })
  }
  function toggle(id: OnboardingStepId, enabled: boolean) {
    patch({ steps: config.steps.map((s) => (s.id === id ? { ...s, enabled } : s)) })
  }

  const enabledCount = config.steps.filter((s) => s.enabled).length

  return (
    <div className="space-y-5">
      <SubCard title="Delivery" desc="Where new members receive the onboarding panel.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label="Deliver via">
            <div className="flex gap-2">
              {(['channel', 'dm'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => patch({ delivery: d })}
                  className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition"
                  style={{
                    borderColor: config.delivery === d ? 'var(--p-1)' : 'var(--line-strong)',
                    background: config.delivery === d ? 'color-mix(in srgb, var(--p-1) 12%, transparent)' : 'var(--bg-2)',
                    color: config.delivery === d ? 'var(--text)' : 'var(--text-2)',
                  }}
                >
                  {d === 'channel' ? 'A channel' : 'Direct message'}
                </button>
              ))}
            </div>
          </Labeled>
          {config.delivery === 'channel' && (
            <Labeled label="Onboarding channel" hint="Welcome embed + panel posts here on join.">
              <ChannelSelect value={config.channel_id} onChange={(v) => patch({ channel_id: v })} channels={channels} allowNone nonePlaceholder="— Select a channel —" />
            </Labeled>
          )}
        </div>
        <label className="mt-4 flex items-center justify-between gap-3 rounded-lg border p-3" style={{ borderColor: 'var(--line-strong)' }}>
          <span className="text-sm text-foreground">
            Require explicit completion
            <span className="block text-xs" style={{ color: 'var(--text-3)' }}>Members click “Finish” to complete and earn rewards. Off = auto-complete.</span>
          </span>
          <Toggle checked={config.completion_required} onChange={(v) => patch({ completion_required: v })} />
        </label>
      </SubCard>

      <SubCard title="Steps" desc={`Reorder and toggle the journey. ${enabledCount} step${enabledCount === 1 ? '' : 's'} enabled.`}>
        <ol className="space-y-2">
          {config.steps.map((s, i) => {
            const meta = ONBOARDING_STEP_META[s.id]
            return (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-lg border p-3"
                style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', opacity: s.enabled ? 1 : 0.6 }}
              >
                <span className="flex flex-col">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-subtle disabled:opacity-30 hover:text-foreground"><ArrowUp size={13} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === config.steps.length - 1} className="text-subtle disabled:opacity-30 hover:text-foreground"><ArrowDown size={13} /></button>
                </span>
                <GripVertical size={14} className="text-subtle" />
                <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--p-1) 12%, transparent)', color: 'var(--p-1)' }}>
                  <Icon name={meta.icon} size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{i + 1}. {meta.label}</span>
                  <span className="block text-xs" style={{ color: 'var(--text-3)' }}>{meta.desc}</span>
                </span>
                {meta.locked ? (
                  <span className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Always on</span>
                ) : (
                  <Toggle checked={s.enabled} onChange={(v) => toggle(s.id, v)} />
                )}
              </li>
            )
          })}
        </ol>
      </SubCard>
    </div>
  )
}

// ── Welcome ─────────────────────────────────────────────────────────────────

export function WelcomeSection({ config, patch, channels }: SectionProps) {
  const w = config.welcome
  const setW = (p: Partial<typeof w>) => patch({ welcome: { ...w, ...p } })

  return (
    <div className="space-y-5">
      <SubCard title="Embed" desc="The greeting card shown to every new member. Use {user} and {server} placeholders.">
        <div className="space-y-4">
          <Labeled label="Title"><TextInput value={w.title} onChange={(v) => setW({ title: v })} maxLength={256} placeholder="Welcome to {server}!" /></Labeled>
          <Labeled label="Description"><TextArea value={w.description} onChange={(v) => setW({ description: v })} rows={4} maxLength={2000} /></Labeled>
          <AccentColorPicker value={w.color} onChange={(v) => setW({ color: v })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Labeled label="Thumbnail">
              <select value={w.thumbnail} onChange={(e) => setW({ thumbnail: e.target.value as typeof w.thumbnail })} className="w-full rounded-lg border px-3 py-2 text-sm outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                <option value="member_avatar">Member avatar</option>
                <option value="guild_icon">Server icon</option>
                <option value="none">None</option>
              </select>
            </Labeled>
            <Labeled label="Footer (optional)"><TextInput value={w.footer_text} onChange={(v) => setW({ footer_text: v })} maxLength={120} placeholder="Pulse · Welcome" /></Labeled>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3" style={{ borderColor: 'var(--line-strong)' }}>
            <span className="flex items-center gap-2 text-sm text-foreground"><ImageIcon size={14} className="text-subtle" /> Full-width server banner</span>
            <Toggle checked={w.banner} onChange={(v) => setW({ banner: v })} />
          </label>
        </div>
      </SubCard>

      <SubCard
        title="Link buttons"
        desc="External link buttons under the welcome embed (e.g. website, store)."
        right={<button type="button" onClick={() => setW({ buttons: [...w.buttons, { label: '', url: '' }] })} disabled={w.buttons.length >= 5} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-40" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}><Plus size={12} /> Add</button>}
      >
        {w.buttons.length === 0 ? (
          <DisabledHint>No link buttons yet.</DisabledHint>
        ) : (
          <div className="space-y-2">
            {w.buttons.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={b.emoji ?? ''} onChange={(e) => setW({ buttons: w.buttons.map((x, j) => j === i ? { ...x, emoji: e.target.value } : x) })} placeholder="🔗" maxLength={4} className="w-12 rounded-lg border px-2 py-2 text-center text-sm" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
                <input value={b.label} onChange={(e) => setW({ buttons: w.buttons.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} placeholder="Label" maxLength={80} className="flex-1 rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
                <input value={b.url} onChange={(e) => setW({ buttons: w.buttons.map((x, j) => j === i ? { ...x, url: e.target.value } : x) })} placeholder="https://" className="flex-[2] rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
                <button type="button" onClick={() => setW({ buttons: w.buttons.filter((_, j) => j !== i) })} className="rounded-lg p-2 text-subtle hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </SubCard>

      <SubCard
        title="Quick links"
        desc="Channel shortcuts shown as a tidy list in the welcome message."
        right={<button type="button" onClick={() => setW({ quick_links: [...w.quick_links, { label: '', channel_id: '' }] })} disabled={w.quick_links.length >= 6} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-40" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}><Plus size={12} /> Add</button>}
      >
        {w.quick_links.length === 0 ? (
          <DisabledHint>No quick links yet.</DisabledHint>
        ) : (
          <div className="space-y-2">
            {w.quick_links.map((q, i) => (
              <div key={i} className="flex items-center gap-2">
                <Link2 size={14} className="text-subtle" />
                <input value={q.label} onChange={(e) => setW({ quick_links: w.quick_links.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} placeholder="Get started" maxLength={80} className="flex-1 rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
                <div className="flex-[2]"><ChannelSelect value={q.channel_id} onChange={(v) => setW({ quick_links: w.quick_links.map((x, j) => j === i ? { ...x, channel_id: v } : x) })} channels={channels} allowNone nonePlaceholder="— Channel —" /></div>
                <button type="button" onClick={() => setW({ quick_links: w.quick_links.filter((_, j) => j !== i) })} className="rounded-lg p-2 text-subtle hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </SubCard>
    </div>
  )
}

// ── Roles ───────────────────────────────────────────────────────────────────

let CAT_SEQ = 0
function newCategoryId() {
  CAT_SEQ += 1
  return `cat_${Date.now().toString(36)}_${CAT_SEQ}`
}

export function RolesSection({ config, patch, roles }: SectionProps) {
  const stepOn = config.steps.find((s) => s.id === 'roles')?.enabled
  const cats = config.roleCategories
  const setCats = (next: RoleCategory[]) => patch({ roleCategories: next })

  function addCategory(category: RoleCategoryId) {
    const meta = ROLE_CATEGORY_META[category]
    setCats([...cats, { id: newCategoryId(), category, label: meta.label, description: meta.desc, min_select: 0, max_select: 0, roles: [] }])
  }
  function updateCat(id: string, p: Partial<RoleCategory>) {
    setCats(cats.map((c) => (c.id === id ? { ...c, ...p } : c)))
  }

  if (!stepOn) return <DisabledHint>The <strong>Self-roles</strong> step is disabled in Flow. Enable it to let members pick roles.</DisabledHint>

  return (
    <div className="space-y-5">
      <SubCard title="Add a category" desc="Group self-assignable roles so members pick what fits them.">
        <div className="flex flex-wrap gap-2">
          {ROLE_CATEGORY_ORDER.map((id) => {
            const meta = ROLE_CATEGORY_META[id]
            return (
              <button key={id} type="button" onClick={() => addCategory(id)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition hover:border-[var(--p-1)]" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
                <Icon name={meta.icon} size={14} /> {meta.label}
              </button>
            )
          })}
        </div>
      </SubCard>

      {cats.length === 0 ? (
        <DisabledHint>No role categories yet — add one above.</DisabledHint>
      ) : (
        cats.map((c) => {
          const meta = ROLE_CATEGORY_META[c.category]
          return (
            <SubCard
              key={c.id}
              title={c.label}
              desc={meta.label}
              right={<button type="button" onClick={() => setCats(cats.filter((x) => x.id !== c.id))} className="rounded-lg p-2 text-subtle hover:text-red-400"><Trash2 size={14} /></button>}
            >
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Labeled label="Display label"><TextInput value={c.label} onChange={(v) => updateCat(c.id, { label: v })} maxLength={80} /></Labeled>
                  <Labeled label="Min select" hint="0 = optional"><NumberInput value={c.min_select} onChange={(v) => updateCat(c.id, { min_select: Math.max(0, v) })} min={0} /></Labeled>
                  <Labeled label="Max select" hint="0 = unlimited"><NumberInput value={c.max_select} onChange={(v) => updateCat(c.id, { max_select: Math.max(0, v) })} min={0} /></Labeled>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">Roles in this category</span>
                    <button type="button" onClick={() => updateCat(c.id, { roles: [...c.roles, { role_id: '', label: '' }] })} disabled={c.roles.length >= 25} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs disabled:opacity-40" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}><Plus size={11} /> Add role</button>
                  </div>
                  {c.roles.length === 0 ? (
                    <DisabledHint>No roles added.</DisabledHint>
                  ) : (
                    <div className="space-y-2">
                      {c.roles.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input value={r.emoji ?? ''} onChange={(e) => updateCat(c.id, { roles: c.roles.map((x, j) => j === i ? { ...x, emoji: e.target.value } : x) })} placeholder="🔔" maxLength={4} className="w-12 rounded-lg border px-2 py-2 text-center text-sm" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
                          <div className="flex-1"><RoleSelect value={r.role_id} onChange={(v) => updateCat(c.id, { roles: c.roles.map((x, j) => j === i ? { ...x, role_id: v, label: x.label || roles.find((rr) => rr.id === v)?.name || '' } : x) })} roles={roles} /></div>
                          <input value={r.label} onChange={(e) => updateCat(c.id, { roles: c.roles.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} placeholder="Label" maxLength={80} className="flex-1 rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
                          <button type="button" onClick={() => updateCat(c.id, { roles: c.roles.filter((_, j) => j !== i) })} className="rounded-lg p-2 text-subtle hover:text-red-400"><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SubCard>
          )
        })
      )}
    </div>
  )
}

// ── Events ──────────────────────────────────────────────────────────────────

export function EventsSection({ config, patch, events }: SectionProps) {
  const stepOn = config.steps.find((s) => s.id === 'events')?.enabled
  const e = config.events
  const setE = (p: Partial<typeof e>) => patch({ events: { ...e, ...p } })
  if (!stepOn) return <DisabledHint>The <strong>Events</strong> step is disabled in Flow. Enable it to showcase events.</DisabledHint>

  const featured = new Set(e.featured)
  return (
    <div className="space-y-5">
      <SubCard title="Event showcase" desc="Surface upcoming Discord events so new members can join in.">
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3" style={{ borderColor: 'var(--line-strong)' }}>
            <span className="text-sm text-foreground">Auto-list upcoming events<span className="block text-xs" style={{ color: 'var(--text-3)' }}>Always show the soonest scheduled events.</span></span>
            <Toggle checked={e.show_upcoming} onChange={(v) => setE({ show_upcoming: v })} />
          </label>
          <Labeled label="Max events shown"><NumberInput value={e.max} onChange={(v) => setE({ max: Math.min(10, Math.max(1, v)) })} min={1} max={10} /></Labeled>
        </div>
      </SubCard>

      <SubCard title="Featured events" desc="Pin specific events to the top of the showcase.">
        {events.length === 0 ? (
          <DisabledHint>No upcoming scheduled events in this server.</DisabledHint>
        ) : (
          <div className="space-y-2">
            {events.map((ev) => {
              const on = featured.has(ev.id)
              return (
                <button key={ev.id} type="button" onClick={() => setE({ featured: on ? e.featured.filter((x) => x !== ev.id) : [...e.featured, ev.id] })} className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition" style={{ borderColor: on ? 'var(--p-1)' : 'var(--line-strong)', background: on ? 'color-mix(in srgb, var(--p-1) 10%, transparent)' : 'var(--bg-2)' }}>
                  <CalendarDays size={15} className="text-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{ev.name}</span>
                    <span className="block text-xs" style={{ color: 'var(--text-3)' }}>{new Date(ev.scheduled_start_time).toLocaleString()} · {ev.user_count} interested</span>
                  </span>
                  {on && <CheckCircle2 size={16} style={{ color: 'var(--p-1)' }} />}
                </button>
              )
            })}
          </div>
        )}
      </SubCard>
    </div>
  )
}

// ── Community ───────────────────────────────────────────────────────────────

export function CommunitySection({ config, patch, channels }: SectionProps) {
  const stepOn = config.steps.find((s) => s.id === 'community')?.enabled
  const links = config.community
  if (!stepOn) return <DisabledHint>The <strong>Community</strong> step is disabled in Flow. Enable it to highlight channels.</DisabledHint>
  return (
    <SubCard title="Featured channels" desc="Point new members to the channels that matter most. Leave blank to hide.">
      <div className="grid gap-4 sm:grid-cols-2">
        {COMMUNITY_LINK_ORDER.map((key: CommunityLinkKey) => {
          const meta = COMMUNITY_LINK_META[key]
          return (
            <Labeled key={key} label={meta.label} hint={meta.desc}>
              <ChannelSelect value={links[key] ?? ''} onChange={(v) => patch({ community: { ...links, [key]: v } })} channels={channels} allowNone nonePlaceholder="— Not shown —" />
            </Labeled>
          )
        })}
      </div>
    </SubCard>
  )
}

// ── Verification ────────────────────────────────────────────────────────────

export function VerificationSection({ config, patch, roles }: SectionProps) {
  const stepOn = config.steps.find((s) => s.id === 'verification')?.enabled
  const v = config.verification
  const setV = (p: Partial<typeof v>) => patch({ verification: { ...v, ...p } })
  if (!stepOn) return <DisabledHint>The <strong>Verification</strong> step is disabled in Flow. Enable it to add a verify gate.</DisabledHint>
  return (
    <SubCard
      title="Verify gate"
      desc="A button that grants a verified role and guides members through access."
      right={<Toggle checked={v.enabled} onChange={(val) => setV({ enabled: val })} />}
    >
      {!v.enabled ? (
        <DisabledHint>Verification is off. Toggle it on to configure the gate.</DisabledHint>
      ) : (
        <div className="space-y-4">
          <Labeled label="Verified role" hint="Granted when a member clicks the verify button."><RoleSelect value={v.role_id} onChange={(val) => setV({ role_id: val })} roles={roles} /></Labeled>
          <div className="grid gap-4 sm:grid-cols-2">
            <Labeled label="Button label"><TextInput value={v.button_label} onChange={(val) => setV({ button_label: val })} maxLength={80} /></Labeled>
            <Labeled label="Success message"><TextInput value={v.success_message} onChange={(val) => setV({ success_message: val })} maxLength={200} /></Labeled>
          </div>
          <div className="flex items-center gap-2 rounded-lg border p-3 text-xs" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
            <ShieldIcon size={14} /> The bot needs <strong className="text-foreground">Manage Roles</strong>, and the verified role must sit below Pulse’s top role.
          </div>
        </div>
      )}
    </SubCard>
  )
}

// ── Rewards ─────────────────────────────────────────────────────────────────

export function RewardsSection({ config, patch, roles }: SectionProps) {
  const stepOn = config.steps.find((s) => s.id === 'rewards')?.enabled
  const r = config.rewards
  const setR = (p: Partial<typeof r>) => patch({ rewards: { ...r, ...p } })
  if (!stepOn) return <DisabledHint>The <strong>Rewards</strong> step is disabled in Flow. Enable it to reward completion.</DisabledHint>
  return (
    <SubCard
      title="Completion rewards"
      desc="Granted once when a member finishes onboarding."
      right={<Toggle checked={r.enabled} onChange={(val) => setR({ enabled: val })} />}
    >
      {!r.enabled ? (
        <DisabledHint>Rewards are off.</DisabledHint>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Labeled label="XP reward" hint="Added via the Levels system."><NumberInput value={r.xp} onChange={(v) => setR({ xp: Math.max(0, v) })} min={0} step={10} /></Labeled>
            <Labeled label="Reputation bonus" hint="Added to the member's trust score."><NumberInput value={r.reputation} onChange={(v) => setR({ reputation: Math.max(0, v) })} min={0} /></Labeled>
          </div>
          <Labeled label="Starter roles" hint="Assigned on completion."><RoleMultiSelect selected={r.role_ids} onToggle={(id) => setR({ role_ids: r.role_ids.includes(id) ? r.role_ids.filter((x) => x !== id) : [...r.role_ids, id] })} roles={roles} /></Labeled>
        </div>
      )}
    </SubCard>
  )
}

// ── Analytics ───────────────────────────────────────────────────────────────

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-3)' }}>
        <span style={{ color: accent }}>{icon}</span> {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold text-foreground">{value}</div>
    </div>
  )
}

export function AnalyticsSection({ stats, roles }: { stats: OnboardingStats | null; roles: RoleOpt[] }) {
  if (!stats || stats.starts === 0) {
    return <DisabledHint>No onboarding activity yet. Stats appear here once members start onboarding.</DisabledHint>
  }
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? `Role ${id.slice(0, 6)}`
  const maxSeries = Math.max(1, ...stats.series.map((s) => Math.max(s.starts, s.completions)))
  const maxRole = Math.max(1, ...stats.roles.map((r) => r.count))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<Users size={13} />} label="Starts" value={String(stats.starts)} accent="#6366f1" />
        <Stat icon={<CheckCircle2 size={13} />} label="Completions" value={String(stats.completions)} accent="#22c55e" />
        <Stat icon={<TrendingUp size={13} />} label="Completion rate" value={`${Math.round(stats.completion_rate * 100)}%`} accent="#f59e0b" />
        <Stat icon={<ShieldIcon size={13} />} label="Verified" value={String(stats.verified)} accent="#06b6d4" />
      </div>

      <SubCard title="Last 30 days" desc="Starts vs. completions per day.">
        <div className="flex h-32 items-end gap-1">
          {stats.series.map((d) => (
            <div key={d.date} className="group relative flex flex-1 items-end justify-center gap-0.5" title={`${d.date}: ${d.starts} started, ${d.completions} completed`}>
              <div className="w-full max-w-2 rounded-t" style={{ height: `${(d.starts / maxSeries) * 100}%`, background: 'color-mix(in srgb, #6366f1 60%, transparent)', minHeight: d.starts ? 2 : 0 }} />
              <div className="w-full max-w-2 rounded-t" style={{ height: `${(d.completions / maxSeries) * 100}%`, background: '#22c55e', minHeight: d.completions ? 2 : 0 }} />
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-4 text-xs" style={{ color: 'var(--text-3)' }}>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: '#6366f1' }} /> Starts</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: '#22c55e' }} /> Completions</span>
        </div>
      </SubCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SubCard title="Most-picked roles" desc="Self-roles selected during onboarding.">
          {stats.roles.length === 0 ? <DisabledHint>No roles selected yet.</DisabledHint> : (
            <div className="space-y-2">
              {stats.roles.slice(0, 8).map((r) => (
                <div key={r.role_id}>
                  <div className="mb-1 flex justify-between text-xs"><span className="text-foreground">{roleName(r.role_id)}</span><span style={{ color: 'var(--text-3)' }}>{r.count}</span></div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}><div className="h-full rounded-full" style={{ width: `${(r.count / maxRole) * 100}%`, background: 'linear-gradient(90deg, var(--p-1), var(--p-2))' }} /></div>
                </div>
              ))}
            </div>
          )}
        </SubCard>
        <SubCard title="Most-skipped steps" desc="Where members drop off.">
          {stats.skipped.length === 0 ? <DisabledHint>No steps skipped yet.</DisabledHint> : (
            <div className="space-y-2">
              {stats.skipped.map((s) => (
                <div key={s.step_id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line-strong)' }}>
                  <span className="flex items-center gap-2 text-foreground"><Icon name={ONBOARDING_STEP_META[s.step_id]?.icon ?? 'Hand'} size={14} /> {ONBOARDING_STEP_META[s.step_id]?.label ?? s.step_id}</span>
                  <span style={{ color: 'var(--text-3)' }}>{s.count}×</span>
                </div>
              ))}
            </div>
          )}
        </SubCard>
      </div>
    </div>
  )
}
