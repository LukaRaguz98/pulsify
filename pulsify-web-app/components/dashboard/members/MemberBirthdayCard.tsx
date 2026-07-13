'use client'

import { useCallback, useEffect, useState } from 'react'
import { Cake, Check, Trash2, PartyPopper } from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { createClient as createSupabase } from '@/lib/supabase'
import {
  MONTHS,
  daysInMonth,
  formatBirthday,
  countdownLabel,
  daysUntilBirthday,
  ageTurning,
  isValidTimeZone,
  validateBirthday,
  maxBirthYear,
  MIN_BIRTH_YEAR,
  TIMEZONE_OPTIONS,
  type MemberBirthday,
} from '@/lib/birthdays'

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

export function MemberBirthdayCard({
  guildId,
  userId,
  isSelf,
}: {
  guildId: string
  userId: string
  isSelf: boolean
}) {
  const [birthday, setBirthday] = useState<MemberBirthday | null>(null)
  const [guildTz, setGuildTz] = useState('UTC')
  const [loaded, setLoaded] = useState(false)

  // Editable form state (self only).
  const [month, setMonth] = useState(1)
  const [day, setDay] = useState(1)
  const [year, setYear] = useState('')
  const [tz, setTz] = useState('')
  const [hideYear, setHideYear] = useState(false)
  const [announce, setAnnounce] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createSupabase()
    const [bd, settings] = await Promise.all([
      supabase.from('member_birthdays').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle(),
      supabase.from('birthday_settings').select('settings').eq('guild_id', guildId).maybeSingle(),
    ])
    const row = (bd.data as MemberBirthday | null) ?? null
    setBirthday(row)
    const s = settings.data?.settings as Record<string, unknown> | undefined
    if (s && typeof s.timezone === 'string' && isValidTimeZone(s.timezone)) setGuildTz(s.timezone)
    if (row) {
      setMonth(row.birth_month)
      setDay(row.birth_day)
      setYear(row.birth_year ? String(row.birth_year) : '')
      setTz(row.timezone ?? '')
      setHideYear(!row.show_year)
      setAnnounce(row.announce)
    }
    setLoaded(true)
  }, [guildId, userId])

  useEffect(() => {
    void load()
    const supabase = createSupabase()
    const channel = supabase
      .channel(`member-birthday:${guildId}:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_birthdays', filter: `guild_id=eq.${guildId}` }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [guildId, userId, load])

  async function handleSave() {
    const y = year.trim() ? Number(year) : null
    const err = validateBirthday(month, day, y)
    if (err) {
      setError(err)
      return
    }
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/discord/guild/${guildId}/birthday`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, day, year: y, timezone: tz || null, show_year: !hideYear, announce }),
    })
    setSaving(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Could not save your birthday.')
      return
    }
    setEditing(false)
    void load()
  }

  async function handleRemove() {
    setSaving(true)
    await fetch(`/api/discord/guild/${guildId}/birthday`, { method: 'DELETE' })
    setSaving(false)
    setEditing(false)
    setBirthday(null)
  }

  // Non-members / others with no birthday set → render nothing.
  if (loaded && !isSelf && !birthday) return null
  if (!loaded) return null

  const effectiveTz = birthday?.timezone && isValidTimeZone(birthday.timezone) ? birthday.timezone : guildTz
  const days = birthday ? daysUntilBirthday(birthday.birth_month, birthday.birth_day, new Date(), effectiveTz) : 0
  const age = birthday && birthday.show_year ? ageTurning(birthday.birth_year, birthday.birth_month, birthday.birth_day, new Date(), effectiveTz) : null

  const description = isSelf
    ? 'Set your birthday so the server can celebrate you. You choose whether to show your age or keep it private.'
    : 'When this member celebrates their birthday.'

  return (
    <CategorySection icon={<Cake size={14} />} title="Birthday" helpId="birthdays" description={description}>
      {/* Display */}
      {birthday && !editing && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: 'rgba(244,114,182,0.15)', color: '#f472b6' }}>
            {days === 0 ? <PartyPopper size={18} /> : <Cake size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {formatBirthday(birthday.birth_month, birthday.birth_day, birthday.birth_year, birthday.show_year)}
            </p>
            <p className="text-xs text-subtle">
              {countdownLabel(days)}
              {age != null ? ` · turning ${age}` : ''}
              {isSelf && !birthday.announce ? ' · announcements off' : ''}
            </p>
          </div>
          {isSelf && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditing(true)}
                className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              >
                Edit
              </button>
              <button
                onClick={handleRemove}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                style={{ borderColor: 'rgba(239,68,68,0.35)', color: '#f87171' }}
              >
                <Trash2 size={12} /> Remove
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state (self, no birthday) */}
      {isSelf && !birthday && !editing && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <p className="text-sm text-subtle">You haven’t set your birthday yet.</p>
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
            style={{ background: 'var(--p-1)' }}
          >
            <Cake size={14} /> Set your birthday
          </button>
        </div>
      )}

      {/* Editor (self) */}
      {isSelf && editing && (
        <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          {error && <p className="mb-3 text-xs" style={{ color: '#f87171' }}>{error}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Month</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={fieldStyle}
              >
                {MONTHS.map((m, i) => (
                  <option key={i} value={i + 1}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Day</label>
              <input
                type="number"
                min={1}
                max={daysInMonth(month)}
                value={day}
                onChange={(e) => setDay(Math.max(1, Math.min(daysInMonth(month), Number(e.target.value) || 1)))}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={fieldStyle}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Year (optional)</label>
              <input
                type="number"
                min={MIN_BIRTH_YEAR}
                max={maxBirthYear()}
                placeholder="—"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={fieldStyle}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Timezone (optional)</label>
            <select
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 sm:max-w-xs"
              style={fieldStyle}
            >
              <option value="">Use server timezone</option>
              {TIMEZONE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="mt-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={hideYear} onChange={(e) => setHideYear(e.target.checked)} />
              Hide my age / birth year
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
              Allow a public birthday announcement
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--p-1)' }}
            >
              <Check size={14} /> {saving ? 'Saving…' : 'Save birthday'}
            </button>
            <button
              onClick={() => {
                setEditing(false)
                setError(null)
              }}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </CategorySection>
  )
}
