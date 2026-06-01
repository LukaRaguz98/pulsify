'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, AlertTriangle } from 'lucide-react'

export type ConfirmTone = 'default' | 'destructive' | 'warning'

type TextField = {
  key: string
  kind: 'text' | 'textarea'
  label: string
  placeholder?: string
  required?: boolean
  maxLength?: number
  defaultValue?: string
}

type NumberField = {
  key: string
  kind: 'number'
  label: string
  placeholder?: string
  min?: number
  max?: number
  defaultValue?: number
}

type SelectField = {
  key: string
  kind: 'select'
  label: string
  options: { label: string; value: string }[]
  defaultValue?: string
}

export type FieldDef = TextField | NumberField | SelectField

type Props = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
  fields?: FieldDef[]
  busy?: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: (values: Record<string, string>) => void
}

const TONE_STYLES: Record<ConfirmTone, { bg: string; border: string; color: string; icon?: string }> = {
  default: {
    bg: 'var(--p-soft)',
    border: 'color-mix(in srgb, var(--p-1) 30%, transparent)',
    color: 'var(--p-1)',
  },
  destructive: {
    bg: 'rgba(239,68,68,0.1)',
    border: 'rgba(239,68,68,0.4)',
    color: '#f87171',
    icon: '#f87171',
  },
  warning: {
    bg: 'rgba(245,158,11,0.1)',
    border: 'rgba(245,158,11,0.4)',
    color: '#f59e0b',
    icon: '#f59e0b',
  },
}

function initialValues(fields: FieldDef[]): Record<string, string> {
  const initial: Record<string, string> = {}
  for (const f of fields) {
    initial[f.key] = String(f.defaultValue ?? '')
  }
  return initial
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  fields = [],
  busy = false,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(fields))
  const firstFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null)

  useEffect(() => {
    requestAnimationFrame(() => firstFieldRef.current?.focus())
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  function setValue(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    for (const f of fields) {
      if ((f.kind === 'text' || f.kind === 'textarea') && f.required && !values[f.key]?.trim()) {
        return
      }
    }
    onConfirm(values)
  }

  const toneCfg = TONE_STYLES[tone]

  if (typeof document === 'undefined') return null

  // Portal to <body> so the dialog escapes the page's per-element stacking
  // contexts — globals.css sets `* { position: relative; z-index: 1 }`, which
  // otherwise lets later page cards paint over an inline-rendered dialog.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onCancel()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div
          className="flex shrink-0 items-start gap-3 border-b px-5 py-4"
          style={{ borderColor: 'var(--line-strong)' }}
        >
          {tone !== 'default' && (
            <span
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: toneCfg.bg, color: toneCfg.icon ?? toneCfg.color }}
            >
              <AlertTriangle size={16} />
            </span>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-foreground">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto">
        {fields.length > 0 && (
          <div className="space-y-3 px-5 py-4">
            {fields.map((f, idx) => {
              const ref = idx === 0
                ? (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null) => {
                    firstFieldRef.current = el
                  }
                : undefined
              const baseStyle: React.CSSProperties = {
                background: 'var(--bg-2)',
                borderColor: 'var(--line-strong)',
                color: 'var(--text)',
              }
              return (
                <div key={f.key}>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    {f.label}
                    {(f.kind === 'text' || f.kind === 'textarea') && f.required && (
                      <span className="ml-1 text-[#f87171]">*</span>
                    )}
                  </label>
                  {f.kind === 'textarea' ? (
                    <textarea
                      ref={ref as (el: HTMLTextAreaElement | null) => void}
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValue(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      maxLength={f.maxLength}
                      rows={3}
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                      style={baseStyle}
                    />
                  ) : f.kind === 'number' ? (
                    <input
                      ref={ref as (el: HTMLInputElement | null) => void}
                      type="number"
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValue(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      min={f.min}
                      max={f.max}
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                      style={baseStyle}
                    />
                  ) : f.kind === 'select' ? (
                    <select
                      ref={ref as (el: HTMLSelectElement | null) => void}
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValue(f.key, e.target.value)}
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                      style={baseStyle}
                    >
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      ref={ref as (el: HTMLInputElement | null) => void}
                      type="text"
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValue(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      maxLength={f.maxLength}
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                      style={baseStyle}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {error && (
          <div
            className="mx-5 mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
            style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
          >
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        </div>

        <div
          className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)' }}
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
            style={{
              borderColor: toneCfg.border,
              background: toneCfg.bg,
              color: toneCfg.color,
            }}
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
