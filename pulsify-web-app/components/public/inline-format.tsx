/**
 * Tiny inline-markdown renderer shared by the release-notes timeline and
 * the Community page's changelog teaser. The release-notes source files use
 * `**bold**` to highlight feature names inside bullet bodies, descriptions
 * and closing paragraphs — print those as <strong> so the asterisks don't
 * leak through to the page.
 *
 * Intentionally minimal: no links, italics or nested markers — just the one
 * marker actually used by `resources/notes/v*.txt`.
 */
export function renderInline(text: string): React.ReactNode {
  // Split on `**...**` while keeping the captured group, so even indices are
  // plain text and odd indices become bold.
  const parts = text.split(/\*\*([^*]+?)\*\*/g)
  return parts.map((part, idx) =>
    idx % 2 === 1
      ? <strong key={idx} className="font-semibold text-foreground">{part}</strong>
      : <span key={idx}>{part}</span>,
  )
}
