import { useEffect } from 'react'

/**
 * Shared modal/dialog behaviour so every dialog feels the same:
 * - **Escape closes it** — ignored while `busy` so it can't be dismissed
 *   mid-save.
 * - Sets the `slide-over-open` body flag while mounted, which globals.css uses
 *   to hide the corner chrome (decorations, Discord icon, app footer) that the
 *   universal `* { z-index: 1 }` rule would otherwise paint over the dialog.
 *
 * Deliberately does NOT lock body scroll: in the dashboard the scroll container
 * is `<main>`, not `<body>`, so a body-level overflow lock would be a no-op.
 *
 * Call once near the top of a dialog component, passing its `onClose` and a
 * busy/saving flag.
 */
export function useDialogDismiss(onClose: () => void, busy = false) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  useEffect(() => {
    document.body.classList.add('slide-over-open')
    return () => document.body.classList.remove('slide-over-open')
  }, [])
}
