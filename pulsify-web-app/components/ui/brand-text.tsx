import { Fragment, isValidElement, cloneElement, type ReactNode, type ReactElement } from 'react'

const BRAND = 'Pulsify'

/**
 * Wraps every occurrence of "Pulsify" in `node` with an accent-coloured span —
 * `var(--p-1)`, the accent the user picks in Preferences → App Design. Recurses
 * into arrays and element children so it works on plain-string descriptions and
 * JSX ones alike. Used by page/view headers to brand the product name in the
 * short description shown under each title.
 */
export function highlightBrand(node: ReactNode): ReactNode {
  if (typeof node === 'string') {
    if (!node.includes(BRAND)) return node
    const segments = node.split(BRAND)
    const out: ReactNode[] = []
    segments.forEach((seg, i) => {
      if (i > 0) {
        out.push(
          <span key={`brand-${i}`} className="font-medium" style={{ color: 'var(--p-1)' }}>
            {BRAND}
          </span>,
        )
      }
      if (seg) out.push(<Fragment key={`seg-${i}`}>{seg}</Fragment>)
    })
    // When the description ends on the brand word it would otherwise finish on
    // the coloured span with no punctuation. Add a trailing period OUTSIDE the
    // span so the sentence is closed and the period keeps the normal text colour.
    if (node.endsWith(BRAND)) {
      out.push(<Fragment key="brand-period">.</Fragment>)
    }
    return out
  }
  if (Array.isArray(node)) {
    return node.map((child, i) => <Fragment key={i}>{highlightBrand(child)}</Fragment>)
  }
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>
    if (el.props.children == null) return node
    return cloneElement(el, undefined, highlightBrand(el.props.children))
  }
  return node
}
