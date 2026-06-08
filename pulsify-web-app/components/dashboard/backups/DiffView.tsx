'use client'

import { Plus, Minus, PencilLine, Check } from 'lucide-react'
import { SECTION_META, type BackupDiff } from '@/lib/backups'
import { BackupIcon } from './icons'

/** Visual change summary shared by Restore Preview and Backup Comparison.
 *  Semantics depend on the caller:
 *   • Restore preview: added = will be created, modified = will be overwritten,
 *     removed = exists live but not in the backup (informational only).
 *   • Comparison: added/removed/modified are base→target deltas. */
export function DiffView({
  diff,
  addedLabel = 'Added',
  removedLabel = 'Removed',
  modifiedLabel = 'Changed',
  emptyText = 'No differences — these are identical.',
}: {
  diff: BackupDiff
  addedLabel?: string
  removedLabel?: string
  modifiedLabel?: string
  emptyText?: string
}) {
  const empty = diff.totals.added === 0 && diff.totals.removed === 0 && diff.totals.modified === 0
  if (empty) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border px-3 py-3 text-sm"
        style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-2)' }}
      >
        <Check size={14} style={{ color: '#22c55e' }} />
        {emptyText}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Totals strip */}
      <div className="flex flex-wrap gap-2 text-xs font-medium">
        <Tally icon={<Plus size={12} />} n={diff.totals.added} label={addedLabel} color="#22c55e" />
        <Tally icon={<PencilLine size={12} />} n={diff.totals.modified} label={modifiedLabel} color="#f59e0b" />
        <Tally icon={<Minus size={12} />} n={diff.totals.removed} label={removedLabel} color="#f87171" />
      </div>

      <div className="space-y-2">
        {diff.sections.map((s) => {
          const meta = SECTION_META[s.key]
          const changed = s.added.length + s.removed.length + s.modified.length
          if (changed === 0) return null
          return (
            <div
              key={s.key}
              className="rounded-lg border p-3"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-md"
                  style={{ background: `color-mix(in srgb, ${meta.accent} 18%, transparent)`, color: meta.accent }}
                >
                  <BackupIcon name={meta.icon} size={13} />
                </span>
                <span className="text-sm font-semibold text-foreground">{meta.label}</span>
              </div>
              <div className="space-y-1.5 pl-1">
                <ChangeRow icon={<Plus size={12} />} color="#22c55e" label={addedLabel} items={s.added} />
                <ChangeRow icon={<PencilLine size={12} />} color="#f59e0b" label={modifiedLabel} items={s.modified} />
                <ChangeRow icon={<Minus size={12} />} color="#f87171" label={removedLabel} items={s.removed} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Tally({ icon, n, label, color }: { icon: React.ReactNode; n: number; label: string; color: string }) {
  if (n === 0)
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
        style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}
      >
        {icon} 0 {label.toLowerCase()}
      </span>
    )
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
    >
      {icon} {n} {label.toLowerCase()}
    </span>
  )
}

function ChangeRow({
  icon,
  color,
  label,
  items,
}: {
  icon: React.ReactNode
  color: string
  label: string
  items: string[]
}) {
  if (items.length === 0) return null
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0" style={{ color }} title={label}>
        {icon}
      </span>
      <div className="flex flex-wrap gap-1">
        {items.map((it) => (
          <span
            key={it}
            className="rounded px-1.5 py-0.5"
            style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  )
}
