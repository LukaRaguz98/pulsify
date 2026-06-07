'use client'

import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'

type Props = {
  title: string
  subtitle?: string
  icon: React.ReactNode
  /** Tailwind max-width class; defaults to a roomy dialog. */
  maxWidth?: string
  busy?: boolean
  onClose: () => void
  children: React.ReactNode
  /** Sticky footer (actions). */
  footer?: React.ReactNode
}

/** Shared centered-modal shell used by the Templates create / apply / import
 *  dialogs. Mirrors MilestoneEditPanel's overlay so the surfaces feel native. */
export function Modal({ title, subtitle, icon, maxWidth = 'max-w-3xl', busy, onClose, children, footer }: Props) {
  useDialogDismiss(onClose, busy)

  if (typeof document === 'undefined') return null

  // Portal to <body> so the dialog escapes the page's per-element stacking
  // contexts (globals.css sets `* { z-index: 1 }`), matching ConfirmDialog.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onClose()}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex w-full ${maxWidth} max-h-[90vh] flex-col rounded-2xl border shadow-2xl overflow-hidden`}
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-center justify-between gap-3 border-b px-5 py-4"
          style={{ borderColor: 'var(--line-strong)' }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
            >
              {icon}
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-foreground">{title}</h2>
              {subtitle && <p className="truncate text-xs text-subtle">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer && (
          <footer
            className="flex items-center justify-end gap-2.5 border-t px-5 py-4"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
          >
            {footer}
          </footer>
        )}
      </aside>
    </div>,
    document.body,
  )
}
