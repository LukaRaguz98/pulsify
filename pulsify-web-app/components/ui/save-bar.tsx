'use client'

import { useState } from 'react'
import { Loader2, RotateCcw, Save } from 'lucide-react'
import { ConfirmDialog, type ConfirmTone } from '@/components/ui/confirm-dialog'

type Props = {
  /** Whether the form has unsaved changes. */
  dirty: boolean
  /** Number of distinct changed fields. Renders as "N unsaved change(s)". Optional. */
  changedCount?: number
  /** Save is in flight. Disables both buttons + spins the save icon. */
  saving?: boolean
  /** Hard-disable both buttons regardless of dirty state. */
  disabled?: boolean
  /** Button text. Settings surfaces all use the same label: "Save settings". */
  saveLabel: string
  /** Sentence rendered on the bar's left side when not dirty. */
  cleanText?: string
  /** Sentence rendered on the bar's left side when dirty (appended after the count). */
  dirtyHintText?: string

  /** Confirm dialog title. */
  confirmTitle: string
  /** Confirm dialog body. */
  confirmDescription?: string
  /** Confirm dialog confirm-button label. Defaults to saveLabel. */
  confirmLabel?: string
  /** Tone of the confirm dialog (default / warning / destructive). */
  confirmTone?: ConfirmTone

  onReset: () => void
  /** Called when the user confirms in the modal. */
  onSave: () => void | Promise<void>
}

/**
 * Sticky save bar used at the bottom of editor pages. Pattern owned by the
 * Server Settings flow — Reset reverts to the captured baseline, Save opens a
 * confirmation modal, busy state spins the save button.
 *
 * Pages must capture an "initial" snapshot of their state and compute `dirty`
 * + `changedCount` from the diff. SaveBar itself doesn't track state — it just
 * renders the bar UI and the confirmation modal.
 */
export function SaveBar({
  dirty,
  changedCount,
  saving = false,
  disabled = false,
  saveLabel,
  cleanText = 'All changes saved.',
  dirtyHintText = 'Review and save to apply.',
  confirmTitle,
  confirmDescription,
  confirmLabel,
  confirmTone = 'default',
  onReset,
  onSave,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  function openConfirm() {
    if (!dirty || saving || disabled) return
    setConfirmOpen(true)
  }

  async function handleConfirm() {
    await onSave()
    setConfirmOpen(false)
  }

  const countLabel =
    typeof changedCount === 'number' && changedCount > 0
      ? `${changedCount} unsaved change${changedCount === 1 ? '' : 's'}`
      : 'Unsaved changes'

  return (
    <>
      <div
        className="sticky bottom-0 z-10 mt-8 -mx-[var(--page-padding,1.5rem)] border-t px-[var(--page-padding,1.5rem)] py-4 backdrop-blur-md"
        style={{
          borderColor: 'var(--line-strong)',
          background: dirty
            ? 'color-mix(in srgb, var(--panel) 80%, transparent)'
            : 'color-mix(in srgb, var(--bg) 60%, transparent)',
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm" style={{ color: dirty ? 'var(--text)' : 'var(--text-3)' }}>
            {dirty ? (
              <>
                <span className="font-semibold">{countLabel}</span>
                {' '}— {dirtyHintText}
              </>
            ) : (
              cleanText
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onReset}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <RotateCcw size={13} />
              Reset
            </button>
            <button
              type="button"
              onClick={openConfirm}
              disabled={!dirty || saving || disabled}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50"
              style={{
                background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
                boxShadow: '0 4px 14px -4px var(--p-glow)',
              }}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? 'Saving…' : saveLabel}
            </button>
          </div>
        </div>
      </div>

      {confirmOpen && (
        <ConfirmDialog
          title={confirmTitle}
          description={confirmDescription}
          confirmLabel={confirmLabel ?? saveLabel}
          tone={confirmTone}
          busy={saving}
          onCancel={() => { if (!saving) setConfirmOpen(false) }}
          onConfirm={handleConfirm}
          fields={[]}
        />
      )}
    </>
  )
}
