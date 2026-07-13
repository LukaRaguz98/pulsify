'use client'

import { useState, useTransition } from 'react'
import { CalendarClock, Loader2, Check, AlertTriangle, ChevronDown } from 'lucide-react'
import {
  BACKUP_LIMITS,
  BACKUP_SECTION_KEYS,
  SECTION_META,
  type BackupSchedule,
  type BackupFrequency,
  type BackupSectionKey,
} from '@/lib/backups'
import { updateSchedule } from '@/app/dashboard/[guildId]/(management)/backups/actions'
import { LocalTime } from './LocalTime'

export function ScheduleCard({ guildId, schedule }: { guildId: string; schedule: BackupSchedule }) {
  const [enabled, setEnabled] = useState(schedule.enabled)
  const [frequency, setFrequency] = useState<BackupFrequency>(schedule.frequency)
  const [retention, setRetention] = useState(schedule.retention)
  const [sections, setSections] = useState<BackupSectionKey[]>(schedule.sectionKeys)
  const [showSections, setShowSections] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, startSave] = useTransition()

  const toggleSection = (key: BackupSectionKey) =>
    setSections((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  function save() {
    setError(null)
    setSaved(false)
    startSave(async () => {
      const res = await updateSchedule(guildId, { enabled, frequency, retention, sectionKeys: sections })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            <CalendarClock size={18} />
          </span>
          <div>
            <h3 className="font-semibold text-foreground">Automatic backups</h3>
            <p className="text-xs text-muted-foreground">
              {schedule.enabled ? (
                <>
                  On · next <LocalTime iso={schedule.nextBackupAt} mode="datetime" /> · last{' '}
                  <LocalTime iso={schedule.lastBackupAt} mode="datetime" />
                </>
              ) : (
                'Let Pulse capture backups for you on a schedule.'
              )}
            </p>
          </div>
        </div>
        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className="relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors"
          style={{ background: enabled ? 'var(--p-1)' : 'var(--line-strong)' }}
        >
          <span
            className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
            style={{ transform: enabled ? 'translateX(20px)' : 'translateX(0)' }}
          />
        </button>
      </div>

      {enabled && (
        <div className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Frequency</span>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as BackupFrequency)}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Keep most recent ({BACKUP_LIMITS.retentionMin}–{BACKUP_LIMITS.retentionMax})
              </span>
              <input
                type="number"
                value={retention}
                min={BACKUP_LIMITS.retentionMin}
                max={BACKUP_LIMITS.retentionMax}
                onChange={(e) => setRetention(Number(e.target.value))}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </label>
          </div>

          {/* Sections to capture automatically */}
          <div>
            <button
              type="button"
              onClick={() => setShowSections((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              <ChevronDown size={13} className={showSections ? 'rotate-180 transition' : 'transition'} />
              Sections captured automatically ({sections.length})
            </button>
            {showSections && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {BACKUP_SECTION_KEYS.map((key) => {
                  const on = sections.includes(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleSection(key)}
                      className="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
                      style={{
                        borderColor: on ? 'var(--p-1)' : 'var(--line-strong)',
                        background: on ? 'var(--p-soft)' : 'transparent',
                        color: on ? 'var(--p-1)' : 'var(--text-3)',
                      }}
                    >
                      {SECTION_META[key].label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div
          className="mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        {saved && (
          <span className="flex items-center gap-1 text-xs" style={{ color: '#22c55e' }}>
            <Check size={13} /> Saved
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50"
          style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}
