'use client'

import { useRef, useState, useSyncExternalStore } from 'react'
import { Search } from 'lucide-react'
import { useCommandPalette } from './CommandPaletteProvider'

// Client-only platform check via useSyncExternalStore: returns false during SSR
// and the first client render (so hydration matches), then settles to the real
// value — no hydration mismatch and no setState-in-effect.
const noopSubscribe = () => () => {}
function useIsMac(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent),
    () => false,
  )
}

/**
 * The "universal search bar" in the sidebar.
 *
 * Expanded: a real text field. Clicking/focusing it just places the cursor —
 * it does NOT open anything. The first character you type hands off to the
 * advanced command palette, seeded with that text, and you keep typing there.
 * ⌘K opens the palette empty (for browsing).
 *
 * Collapsed: there's no room for a field, so it falls back to an icon button
 * that opens the palette on click.
 */
export function SearchTrigger({ collapsed }: { collapsed: boolean }) {
  const { openPalette, openWith } = useCommandPalette()
  const isMac = useIsMac()
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={openPalette}
        title="Search (⌘K)"
        aria-label="Open search"
        className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg border transition-colors"
        style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-3)' }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)'; e.currentTarget.style.color = 'var(--text)' }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)'; e.currentTarget.style.color = 'var(--text-3)' }}
      >
        <Search size={16} />
      </button>
    )
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    if (!next) {
      setValue('')
      return
    }
    // Hand off to the palette. Blur first so any keystrokes landing before the
    // palette grabs focus don't re-trigger this field, and clear it so it's
    // empty again once the palette closes.
    inputRef.current?.blur()
    setValue('')
    openWith(next)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter / ArrowDown on the empty field open the palette for browsing.
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      openPalette()
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors"
      style={{ borderColor: focused ? 'var(--p-1)' : 'var(--line-strong)', background: 'var(--panel)' }}
    >
      <Search size={15} className="shrink-0" style={{ color: 'var(--text-3)' }} />
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search…"
        aria-label="Search"
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-3)]"
        style={{ color: 'var(--text)' }}
      />
      <kbd
        className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none"
        style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-3)' }}
      >
        {isMac ? '⌘' : 'Ctrl'} K
      </kbd>
    </div>
  )
}
