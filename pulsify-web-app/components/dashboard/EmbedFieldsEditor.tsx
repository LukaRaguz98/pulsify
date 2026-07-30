'use client'

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'

export type EmbedField = { name: string; value: string; inline: boolean }

type Props = {
  fields: EmbedField[]
  onChange: (next: EmbedField[]) => void
  /** Placeholder hint under the list — e.g. the {user}/{server} placeholders. */
  hint?: string
  /** What a row is called. Defaults to the embed-card wording; the Server Rules
   *  editor passes rule wording. */
  labels?: {
    /** Plural, heads the list — 'Cards', 'Rules'. */
    list: string
    /** The add button — 'Add card', 'Add rule'. */
    add: string
    /** Shown instead of the list when there are no rows. */
    empty: string
    titlePlaceholder: string
    textPlaceholder: string
  }
}

const DEFAULT_LABELS: NonNullable<Props['labels']> = {
  list: 'Cards',
  add: 'Add card',
  empty: 'No cards. The embed is just the title and description.',
  titlePlaceholder: 'Card title',
  textPlaceholder: 'Card text',
}

const inputClass =
  'w-full rounded-lg border px-3 py-2 text-sm text-foreground outline-none transition-colors'
const inputStyle = { background: 'var(--bg-2)', borderColor: 'var(--line-strong)' } as const

/**
 * Editor for an embed's field "cards" — the `**Name**` / value blocks the bot
 * renders under the description (see buildMemberV2Container in the bot's
 * index.js).
 *
 * Pulse generates these along with the title and description, but until now
 * only the title and description were editable: the cards were previewed and
 * then applied verbatim, so a wrong server name or a rule you didn't want meant
 * regenerating the whole embed and hoping. Editing, reordering, and removing
 * are the minimum for content someone else wrote for you.
 *
 * Also drives the Server Rules per-rule list, where a row is a rule's heading
 * and its text — pass `labels` to reword the chrome.
 */
export function EmbedFieldsEditor({ fields, onChange, hint, labels }: Props) {
  const text = labels ?? DEFAULT_LABELS

  const update = (i: number, patch: Partial<EmbedField>) =>
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))

  const remove = (i: number) => onChange(fields.filter((_, idx) => idx !== i))

  const add = () => onChange([...fields, { name: '', value: '', inline: false }])

  /** Swap a row with its neighbour. Order is meaningful — rules are numbered by
   *  position — so moving beats delete-and-retype. */
  const move = (i: number, delta: -1 | 1) => {
    const target = i + delta
    if (target < 0 || target >= fields.length) return
    const next = [...fields]
    ;[next[i], next[target]] = [next[target], next[i]]
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-muted-foreground">
          {text.list} <span className="text-subtle">({fields.length})</span>
        </label>
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
        >
          <Plus size={11} /> {text.add}
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="text-xs text-subtle">{text.empty}</p>
      ) : (
        <div className="space-y-2">
          {fields.map((f, i) => (
            <div
              key={i}
              className="rounded-lg border p-2.5 space-y-2"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={f.name}
                  placeholder={text.titlePlaceholder}
                  onChange={(e) => update(i, { name: e.target.value })}
                  className={inputClass + ' font-medium'}
                  style={inputStyle}
                />
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${text.titlePlaceholder} ${i + 1} up`}
                    className="rounded-lg border p-2 transition-colors disabled:opacity-30"
                    style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === fields.length - 1}
                    aria-label={`Move ${text.titlePlaceholder} ${i + 1} down`}
                    className="rounded-lg border p-2 transition-colors disabled:opacity-30"
                    style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
                  >
                    <ChevronDown size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={`Remove ${text.titlePlaceholder} ${i + 1}`}
                    className="rounded-lg border p-2 transition-colors"
                    style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <textarea
                value={f.value}
                placeholder={text.textPlaceholder}
                rows={2}
                onChange={(e) => update(i, { value: e.target.value })}
                className={inputClass + ' resize-none'}
                style={inputStyle}
              />
            </div>
          ))}
        </div>
      )}

      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  )
}
