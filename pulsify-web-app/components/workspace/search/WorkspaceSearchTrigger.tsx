'use client'

import { useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useWorkspaceCommandPalette } from './WorkspaceCommandPaletteProvider'

/**
 * The "universal search bar" in the workspace sidebar — the workspace sibling of
 * components/dashboard/search/SearchTrigger.
 *
 * Clicking/focusing the field just places the cursor; the first character you
 * type hands off to the command palette, seeded with that text. ⌘K / Ctrl+K
 * opens the palette empty (the global listener lives in the provider), so the
 * shortcut keeps working even though no key hint is shown here.
 */
export function WorkspaceSearchTrigger() {
  const { openPalette, openWith } = useWorkspaceCommandPalette()
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    if (!next) {
      setValue('')
      return
    }
    // Hand off to the palette. Blur first so keystrokes landing before the
    // palette grabs focus don't re-trigger this field, and clear it so it's
    // empty again once the palette closes.
    inputRef.current?.blur()
    setValue('')
    openWith(next)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
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
        aria-label="Search workspace"
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-3)]"
        style={{ color: 'var(--text)' }}
      />
    </div>
  )
}
