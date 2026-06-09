'use client'

import { useMemo, useState } from 'react'
import {
  Send,
  Plus,
  Trash2,
  GripVertical,
  Loader2,
  LayoutPanelTop,
  Tag,
  ShieldCheck,
  FolderTree,
  FileText,
  Clock,
  ChevronDown,
  ChevronRight,
  ClipboardList,
} from 'lucide-react'
import type { DiscordChannel, DiscordRole } from '@/lib/discord'
import {
  formatChannelName,
  TICKET_LIMITS,
  slugify,
  type TicketConfig,
  type TicketType,
  type TicketFormField,
  type PanelMode,
} from '@/lib/tickets'
import {
  normaliseApplicationTypes,
  APPLICATION_LIMITS,
  type ApplicationType,
} from '@/lib/applications'
import { THEMES } from '@/lib/themes'
import { usePreferences } from '@/components/ThemeProvider'
import type { ActionResult } from '@/app/dashboard/[guildId]/tickets/actions'
import { saveTicketConfig, postTicketPanel } from '@/app/dashboard/[guildId]/tickets/actions'
import { SaveBar } from '@/components/ui/save-bar'
import { ColorPicker } from './ColorPicker'

type RunAction = <T>(fn: () => Promise<ActionResult<T>>, successMsg?: string) => Promise<ActionResult<T>>

type Props = {
  guildId: string
  config: TicketConfig
  channels: DiscordChannel[]
  categories: DiscordChannel[]
  roles: DiscordRole[]
  runAction: RunAction
}

const inputStyle: React.CSSProperties = { background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }

export function TicketSettings({ guildId, config, channels, categories, roles, runAction }: Props) {
  // The accent the admin picked in App Design (custom override → preset theme).
  const { theme, themeCustomColor } = usePreferences()
  const appAccent = themeCustomColor ?? THEMES.find((t) => t.id === theme)?.accent ?? '#8b5cf6'
  // First-time setup (no saved row yet): seed the panel colour from the app
  // accent so tickets match the rest of the dashboard out of the box.
  const makeInitial = (): TicketConfig =>
    config.updated_at ? config : { ...config, panel: { ...config.panel, color: appAccent } }
  const [draft, setDraft] = useState<TicketConfig>(makeInitial)
  // Baseline of the last-saved state — drives the SaveBar's dirty tracking,
  // same as the Pulse Guard settings tab.
  const [snapshot, setSnapshot] = useState<TicketConfig>(makeInitial)
  const [saving, setSaving] = useState(false)
  const [posting, setPosting] = useState(false)
  const [openType, setOpenType] = useState<string | null>(null)

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(snapshot), [draft, snapshot])
  const changedCount = useMemo(() => {
    if (!dirty) return 0
    const cmp = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b)
    let n = 0
    if (draft.enabled !== snapshot.enabled) n++
    if (cmp(draft.panel, snapshot.panel)) n++
    if (cmp(draft.ticket_types, snapshot.ticket_types)) n++
    if (draft.category_id !== snapshot.category_id) n++
    if (cmp(draft.support_role_ids, snapshot.support_role_ids)) n++
    if (draft.transcript_channel_id !== snapshot.transcript_channel_id) n++
    if (draft.log_channel_id !== snapshot.log_channel_id) n++
    if (draft.naming_format !== snapshot.naming_format) n++
    if ((draft.opening_message ?? '') !== (snapshot.opening_message ?? '')) n++
    if (cmp(draft.auto_close, snapshot.auto_close)) n++
    if (draft.per_user_limit !== snapshot.per_user_limit) n++
    if (draft.ping_support !== snapshot.ping_support) n++
    if (cmp(draft.application_types, snapshot.application_types)) n++
    if (draft.application_channel_id !== snapshot.application_channel_id) n++
    if (draft.application_dm !== snapshot.application_dm) n++
    if (draft.application_cooldown !== snapshot.application_cooldown) n++
    return n
  }, [draft, snapshot, dirty])

  const patch = (p: Partial<TicketConfig>) => setDraft((d) => ({ ...d, ...p }))
  const patchPanel = (p: Partial<TicketConfig['panel']>) => setDraft((d) => ({ ...d, panel: { ...d.panel, ...p } }))
  const patchAutoClose = (p: Partial<TicketConfig['auto_close']>) =>
    setDraft((d) => ({ ...d, auto_close: { ...d.auto_close, ...p } }))

  function updateType(i: number, p: Partial<TicketType>) {
    setDraft((d) => ({ ...d, ticket_types: d.ticket_types.map((t, idx) => (idx === i ? { ...t, ...p } : t)) }))
  }
  function addType() {
    if (draft.ticket_types.length >= TICKET_LIMITS.maxTypes) return
    const id = `type-${Date.now().toString(36)}`
    setDraft((d) => ({
      ...d,
      ticket_types: [...d.ticket_types, { id, label: 'New type', enabled: true, form: [] }],
    }))
    setOpenType(id)
  }
  function removeType(i: number) {
    setDraft((d) => ({ ...d, ticket_types: d.ticket_types.filter((_, idx) => idx !== i) }))
  }
  function updateField(ti: number, fi: number, p: Partial<TicketFormField>) {
    setDraft((d) => ({
      ...d,
      ticket_types: d.ticket_types.map((t, idx) =>
        idx === ti ? { ...t, form: t.form.map((f, j) => (j === fi ? { ...f, ...p } : f)) } : t,
      ),
    }))
  }
  function addField(ti: number) {
    setDraft((d) => ({
      ...d,
      ticket_types: d.ticket_types.map((t, idx) =>
        idx === ti && t.form.length < TICKET_LIMITS.maxFormFields
          ? { ...t, form: [...t.form, { id: `q${t.form.length + 1}`, label: 'Question', style: 'short', required: true }] }
          : t,
      ),
    }))
  }
  function removeField(ti: number, fi: number) {
    setDraft((d) => ({
      ...d,
      ticket_types: d.ticket_types.map((t, idx) => (idx === ti ? { ...t, form: t.form.filter((_, j) => j !== fi) } : t)),
    }))
  }
  function toggleRole(roleId: string) {
    setDraft((d) => ({
      ...d,
      support_role_ids: d.support_role_ids.includes(roleId)
        ? d.support_role_ids.filter((r) => r !== roleId)
        : [...d.support_role_ids, roleId],
    }))
  }

  // ── Applications (channel-less) ──
  // The editable type catalog is a typed view over the raw config JSON; it's
  // re-normalised on save (saveTicketConfig → normaliseApplicationTypes).
  const appTypes = useMemo<ApplicationType[]>(
    () => normaliseApplicationTypes(draft.application_types),
    [draft.application_types],
  )
  const hasApplicationType = useMemo(
    () => draft.ticket_types.some((t) => t.kind === 'application' && t.enabled),
    [draft.ticket_types],
  )
  function setAppTypes(next: ApplicationType[]) {
    setDraft((d) => ({ ...d, application_types: next }))
  }
  function updateAppType(i: number, p: Partial<ApplicationType>) {
    setAppTypes(appTypes.map((t, idx) => (idx === i ? { ...t, ...p } : t)))
  }
  function addAppType() {
    if (appTypes.length >= APPLICATION_LIMITS.maxTypes) return
    setAppTypes([...appTypes, { id: `app-${Date.now().toString(36)}`, label: 'New type', enabled: true }])
  }
  function removeAppType(i: number) {
    setAppTypes(appTypes.filter((_, idx) => idx !== i))
  }

  function handleReset() {
    setDraft(snapshot)
  }
  async function handleSave() {
    setSaving(true)
    const res = await runAction(() => saveTicketConfig(guildId, draft), 'Ticket settings saved')
    // Re-baseline on success so the SaveBar returns to its clean state.
    if (res.ok) setSnapshot(draft)
    setSaving(false)
  }
  async function postPanel() {
    setPosting(true)
    // Save first so the panel reflects the latest types/channel.
    const saved = await runAction(() => saveTicketConfig(guildId, draft))
    if (saved.ok) {
      setSnapshot(draft)
      await runAction(() => postTicketPanel(guildId), 'Panel posted to Discord')
    }
    setPosting(false)
  }

  const namePreview = formatChannelName(draft.naming_format, {
    number: (draft.ticket_counter ?? 0) + 1,
    user: 'username',
    type: draft.ticket_types[0]?.id ?? 'support',
  })

  return (
    <div className="space-y-6">
      {/* Master switch */}
      <Card icon={<ShieldCheck size={16} />} title="Ticket system" description="Turn Discord-native support tickets on for this server.">
        <Toggle
          checked={draft.enabled}
          onChange={(v) => patch({ enabled: v })}
          label={draft.enabled ? 'Enabled' : 'Disabled'}
          hint={draft.enabled ? 'Members can open tickets from the panel.' : 'The panel buttons will not create tickets.'}
        />
      </Card>

      {/* Panel */}
      <Card icon={<LayoutPanelTop size={16} />} title="Ticket panel" description="The message Pulse posts in Discord that members click to open a ticket.">
        <div className="space-y-4">
          <ChannelField
            label="Panel channel"
            hint="Where the “Open a ticket” panel message is posted for members."
            value={draft.panel.channel_id ?? ''}
            channels={channels}
            placeholder="Select a channel…"
            onChange={(v) => patchPanel({ channel_id: v || null })}
          />
          <Field label="Title">
            <input value={draft.panel.title} maxLength={100} onChange={(e) => patchPanel({ title: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
          </Field>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-xs font-medium" style={{ color: 'var(--text-2)' }}>Accent colour</label>
              {/* Hex badge mirrors App Design › Accent Colour. */}
              <span
                className="rounded px-1.5 py-0.5 font-mono text-xs"
                style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
              >
                {draft.panel.color}
              </span>
            </div>
            <ColorPicker value={draft.panel.color} onChange={(c) => patchPanel({ color: c })} />
            <p className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>
              Defaults to your App Design accent. Used for the panel and ticket embeds.
            </p>
          </div>
          <Field label="Description">
            <textarea value={draft.panel.description} maxLength={500} rows={2} onChange={(e) => patchPanel({ description: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
          </Field>
          <Field label="Picker style" hint="Buttons support up to 5 types; switch to a dropdown for more.">
            <div className="flex gap-2">
              {(['buttons', 'dropdown'] as PanelMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => patchPanel({ mode: m })}
                  className="rounded-lg border px-3 py-1.5 text-sm font-medium capitalize transition-colors"
                  style={draft.panel.mode === m ? { borderColor: 'var(--p-1)', color: 'var(--p-1)', background: 'var(--p-soft)' } : { borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>
          <div className="flex items-center gap-2 border-t pt-4" style={{ borderColor: 'var(--line-strong)' }}>
            <BusyButton onClick={postPanel} busy={posting} icon={<Send size={14} />} label="Post panel to Discord" tone="primary" />
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>Re-posting sends a fresh panel message.</span>
          </div>
        </div>
      </Card>

      {/* Ticket types */}
      <Card icon={<Tag size={16} />} title="Ticket types" description="The categories members can choose from. Each can ask its own questions.">
        <div className="space-y-3">
          {draft.ticket_types.map((type, ti) => {
            const expanded = openType === type.id
            return (
              <div key={type.id} className="rounded-xl border" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <Toggle checked={type.enabled} onChange={(v) => updateType(ti, { enabled: v })} compact />
                  <input
                    value={type.emoji ?? ''}
                    onChange={(e) => updateType(ti, { emoji: e.target.value })}
                    placeholder="🎫"
                    className="w-10 rounded-md border px-1.5 py-1 text-center text-sm"
                    style={inputStyle}
                  />
                  <input
                    value={type.label}
                    onChange={(e) => updateType(ti, { label: e.target.value })}
                    className="flex-1 rounded-md border px-2.5 py-1 text-sm font-medium"
                    style={inputStyle}
                  />
                  <button onClick={() => setOpenType(expanded ? null : type.id)} className="rounded p-1" style={{ color: 'var(--text-3)' }}>
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <button onClick={() => removeType(ti)} className="rounded p-1" style={{ color: '#f87171' }} aria-label="Remove type">
                    <Trash2 size={14} />
                  </button>
                </div>
                {expanded && (
                  <div className="space-y-3 border-t px-3 py-3" style={{ borderColor: 'var(--line-strong)' }}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Description">
                        <input value={type.description ?? ''} maxLength={100} onChange={(e) => updateType(ti, { description: e.target.value })} className="w-full rounded-md border px-2.5 py-1.5 text-sm" style={inputStyle} />
                      </Field>
                      {type.kind !== 'application' && (
                        <Field label="Category override" hint="Where this type's channels are created.">
                          <CategorySelect value={type.category_id ?? ''} categories={categories} placeholder="Use default category" onChange={(v) => updateType(ti, { category_id: v || null })} />
                        </Field>
                      )}
                    </div>

                    {/* Channel vs. channel-less application */}
                    <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
                      <Toggle
                        checked={type.kind === 'application'}
                        onChange={(v) => updateType(ti, { kind: v ? 'application' : 'channel' })}
                        label="Channel-less application"
                        hint="Opens the application dialog and sends submissions to Applications instead of creating a channel."
                      />
                    </div>

                    {/* Form questions — only for channel tickets; applications use the dialog. */}
                    {type.kind === 'application' ? (
                      <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                        Applications collect what the member is applying for + their details in the dialog. Configure the
                        application types in the <span className="font-medium" style={{ color: 'var(--text-2)' }}>Applications</span> section below.
                      </p>
                    ) : (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Form questions</p>
                        <button onClick={() => addField(ti)} disabled={type.form.length >= TICKET_LIMITS.maxFormFields} className="inline-flex items-center gap-1 text-xs font-medium disabled:opacity-40" style={{ color: 'var(--p-1)' }}>
                          <Plus size={12} /> Add question
                        </button>
                      </div>
                      {type.form.length === 0 ? (
                        <p className="text-xs" style={{ color: 'var(--text-3)' }}>No questions — the ticket opens immediately.</p>
                      ) : (
                        <div className="space-y-2">
                          {type.form.map((f, fi) => (
                            <div key={fi} className="flex items-center gap-2 rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
                              <GripVertical size={13} style={{ color: 'var(--text-3)' }} />
                              <input value={f.label} onChange={(e) => updateField(ti, fi, { label: e.target.value, id: slugify(e.target.value) })} className="flex-1 rounded-md border px-2 py-1 text-sm" style={inputStyle} />
                              <select value={f.style} onChange={(e) => updateField(ti, fi, { style: e.target.value as TicketFormField['style'] })} className="rounded-md border px-1.5 py-1 text-xs" style={inputStyle}>
                                <option value="short">Short</option>
                                <option value="paragraph">Paragraph</option>
                              </select>
                              <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-3)' }}>
                                <input type="checkbox" checked={f.required} onChange={(e) => updateField(ti, fi, { required: e.target.checked })} />
                                Req
                              </label>
                              <button onClick={() => removeField(ti, fi)} className="rounded p-1" style={{ color: '#f87171' }}>
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <button onClick={addType} disabled={draft.ticket_types.length >= TICKET_LIMITS.maxTypes} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-sm font-medium disabled:opacity-40" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
            <Plus size={14} /> Add ticket type
          </button>
        </div>
      </Card>

      {/* Applications */}
      <Card
        icon={<ClipboardList size={16} />}
        title="Applications"
        description="The channel-less application flow: members pick what they're applying for and submit details for review in Pulsify."
      >
        <div className="space-y-4">
          {!hasApplicationType && (
            <div
              className="rounded-lg border px-3 py-2.5 text-xs"
              style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}
            >
              No enabled ticket type uses the application flow yet. Turn on <strong>Channel-less application</strong> for a
              ticket type above so members can apply.
            </div>
          )}

          {/* Application type catalog */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-xs font-medium" style={{ color: 'var(--text-2)' }}>Application types</label>
              <button
                onClick={addAppType}
                disabled={appTypes.length >= APPLICATION_LIMITS.maxTypes}
                className="inline-flex items-center gap-1 text-xs font-medium disabled:opacity-40"
                style={{ color: 'var(--p-1)' }}
              >
                <Plus size={12} /> Add type
              </button>
            </div>
            <div className="space-y-2">
              {appTypes.map((t, i) => (
                <div key={t.id} className="flex items-center gap-2 rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
                  <Toggle checked={t.enabled} onChange={(v) => updateAppType(i, { enabled: v })} compact />
                  <input
                    value={t.emoji ?? ''}
                    onChange={(e) => updateAppType(i, { emoji: e.target.value })}
                    placeholder="🛡️"
                    className="w-10 rounded-md border px-1.5 py-1 text-center text-sm"
                    style={inputStyle}
                  />
                  <input
                    value={t.label}
                    onChange={(e) => updateAppType(i, { label: e.target.value })}
                    className="w-32 rounded-md border px-2 py-1 text-sm font-medium"
                    style={inputStyle}
                  />
                  <input
                    value={t.description ?? ''}
                    maxLength={100}
                    onChange={(e) => updateAppType(i, { description: e.target.value })}
                    placeholder="Short description"
                    className="flex-1 rounded-md border px-2 py-1 text-sm"
                    style={inputStyle}
                  />
                  <button onClick={() => removeAppType(i)} className="rounded p-1" style={{ color: '#f87171' }} aria-label="Remove application type">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
              An <strong>Other</strong> option is always offered so members can enter a custom role.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ChannelField
              label="Admin notification channel"
              hint="A “new application” notice with a review link is posted here for your team."
              value={draft.application_channel_id ?? ''}
              channels={channels}
              placeholder="None"
              onChange={(v) => patch({ application_channel_id: v || null })}
            />
            <Field label="Cooldown (minutes)" hint="Minimum wait between submissions per member. 0 = no cooldown.">
              <input
                type="number"
                min={0}
                max={10080}
                value={draft.application_cooldown}
                onChange={(e) => patch({ application_cooldown: Number(e.target.value) })}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={inputStyle}
              />
            </Field>
          </div>
          <Toggle
            checked={draft.application_dm}
            onChange={(v) => patch({ application_dm: v })}
            label="DM the applicant on submission & decisions"
            hint="Sends a Pulse-styled DM when an application is received and whenever its status changes."
          />
        </div>
      </Card>

      {/* Channels & roles */}
      <Card icon={<FolderTree size={16} />} title="Ticket channels & access" description="Where each new ticket channel is created, who can see it, and how it's named.">
        <div className="space-y-4">
          <Field label="Ticket category" hint="New ticket channels are created inside this Discord category.">
            <CategorySelect value={draft.category_id ?? ''} categories={categories} placeholder="Select a category…" onChange={(v) => patch({ category_id: v || null })} />
          </Field>
          <Field label="Support roles" hint="Granted access to every ticket channel.">
            {roles.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>No assignable roles found.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {roles.slice(0, 60).map((r) => {
                  const on = draft.support_role_ids.includes(r.id)
                  return (
                    <button
                      key={r.id}
                      onClick={() => toggleRole(r.id)}
                      className="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
                      style={on ? { background: 'var(--p-soft)', color: 'var(--p-1)', boxShadow: 'inset 0 0 0 1px var(--p-1)' } : { background: 'var(--bg-2)', color: 'var(--text-3)' }}
                    >
                      @{r.name}
                    </button>
                  )
                })}
              </div>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Channel name format" hint={`Preview: #${namePreview}`}>
              <input value={draft.naming_format} onChange={(e) => patch({ naming_format: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
            </Field>
            <Field label="Tickets per member" hint="Max open tickets one member can hold. 0 = unlimited.">
              <input type="number" min={0} max={50} value={draft.per_user_limit} onChange={(e) => patch({ per_user_limit: Number(e.target.value) })} className="w-full rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
            </Field>
          </div>
          <Field label="Opening message" hint="Posted inside a new ticket. Tokens: {user}, {type}.">
            <textarea value={draft.opening_message ?? ''} maxLength={1000} rows={2} onChange={(e) => patch({ opening_message: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
          </Field>
          <Toggle checked={draft.ping_support} onChange={(v) => patch({ ping_support: v })} label="Ping support roles when a ticket opens" />
        </div>
      </Card>

      {/* Logs & transcripts */}
      <Card icon={<FileText size={16} />} title="Logs & transcripts" description="Two optional channels where Pulse mirrors ticket activity. Leave either as “None” to skip it.">
        {/* Stacked (not side-by-side) so it's always clear which channel is which. */}
        <div className="space-y-4">
          <ChannelField
            label="Transcript channel"
            hint="When a ticket is closed, a summary with its full transcript is posted here."
            value={draft.transcript_channel_id ?? ''}
            channels={channels}
            onChange={(v) => patch({ transcript_channel_id: v || null })}
          />
          <ChannelField
            label="Activity log channel"
            hint="Logs every ticket as it opens, is claimed, closed or reopened — a running audit trail."
            value={draft.log_channel_id ?? ''}
            channels={channels}
            onChange={(v) => patch({ log_channel_id: v || null })}
          />
        </div>
      </Card>

      {/* Auto-close */}
      <Card icon={<Clock size={16} />} title="Inactivity & auto-close" description="Automatically close tickets that go quiet.">
        <div className="space-y-4">
          <Toggle checked={draft.auto_close.enabled} onChange={(v) => patchAutoClose({ enabled: v })} label="Auto-close inactive tickets" />
          {draft.auto_close.enabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Close after (hours of inactivity)">
                <input type="number" min={1} max={720} value={draft.auto_close.inactivity_hours} onChange={(e) => patchAutoClose({ inactivity_hours: Number(e.target.value) })} className="w-full rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
              </Field>
              <Field label="Warn after (hours, 0 = no warning)">
                <input type="number" min={0} max={720} value={draft.auto_close.warn_hours} onChange={(e) => patchAutoClose({ warn_hours: Number(e.target.value) })} className="w-full rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
              </Field>
            </div>
          )}
        </div>
      </Card>

      <SaveBar
        dirty={dirty}
        changedCount={changedCount}
        saving={saving}
        saveLabel="Save settings"
        cleanText="All ticket settings saved."
        dirtyHintText="Changes apply to the bot the moment you save."
        confirmTitle="Save ticket settings?"
        confirmDescription="These settings drive the live ticket panel and the bot's behaviour. Changes take effect immediately."
        onReset={handleReset}
        onSave={handleSave}
      />
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Card({ icon, title, description, children }: { icon: React.ReactNode; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="flex items-start gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>{icon}</span>
        <div>
          <h3 className="font-semibold text-foreground">{title}</h3>
          {description && <p className="mt-0.5 text-sm" style={{ color: 'var(--text-3)' }}>{description}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-2)' }}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>{hint}</p>}
    </div>
  )
}

function Toggle({ checked, onChange, label, hint, compact }: { checked: boolean; onChange: (v: boolean) => void; label?: string; hint?: string; compact?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="relative inline-flex shrink-0 items-center rounded-full transition-colors"
        style={{ width: compact ? 32 : 40, height: compact ? 18 : 22, background: checked ? 'var(--p-1)' : 'var(--line-strong)' }}
        aria-pressed={checked}
      >
        <span
          className="absolute rounded-full bg-white transition-transform"
          style={{
            width: compact ? 12 : 16, height: compact ? 12 : 16,
            left: 3,
            transform: checked ? `translateX(${compact ? 14 : 18}px)` : 'translateX(0)',
          }}
        />
      </button>
      {label && (
        <span>
          <span className="text-sm font-medium text-foreground">{label}</span>
          {hint && <span className="block text-xs" style={{ color: 'var(--text-3)' }}>{hint}</span>}
        </span>
      )}
    </label>
  )
}

/**
 * A labelled channel picker. The channel options render as `#name`, and the
 * field's own label + hint say exactly what the channel is for — so the several
 * channel selections across these settings stay clearly distinct. Used for every
 * standalone channel choice (panel, transcripts, logs, application notifications).
 */
function ChannelField({
  label,
  hint,
  value,
  channels,
  onChange,
  placeholder = 'None',
}: {
  label: string
  hint?: string
  value: string
  channels: DiscordChannel[]
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <Field label={label} hint={hint}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-3 py-2 text-sm"
        style={inputStyle}
      >
        <option value="">{placeholder}</option>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>#{c.name}</option>
        ))}
      </select>
    </Field>
  )
}

function CategorySelect({ value, categories, placeholder, onChange }: { value: string; categories: DiscordChannel[]; placeholder: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={inputStyle}>
      <option value="">{placeholder}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  )
}

function BusyButton({ onClick, busy, icon, label, tone }: { onClick: () => void; busy: boolean; icon: React.ReactNode; label: string; tone?: 'primary' }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-60"
      style={tone === 'primary' ? { background: 'var(--p-1)', color: '#fff' } : { borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}
