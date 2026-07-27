import 'server-only'

/**
 * Minimal, dependency-free PDF writer.
 *
 * Same reasoning as `lib/zip.ts` (the asset export) and the role-hierarchy PNG
 * export: the one thing we need — a paginated, text-only report — is a small
 * fraction of what a PDF library does, and pulling one in for that is a lot of
 * bytes and a lot of surface. So we emit PDF 1.4 by hand: a catalog, a page
 * tree, two base-14 fonts (which every reader has built in, so nothing needs
 * embedding) and one content stream per page.
 *
 * Scope is deliberately narrow — flowed text with headings, key/value rows and
 * rules, wrapped and paginated. No images, tables, links or vector graphics
 * beyond horizontal lines. If a future export needs more than that, this is
 * the moment to reconsider a real library.
 */

// ── Page geometry (A4, in PostScript points) ─────────────────────────────
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 48
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
/** Reserve for the page footer so body text never collides with it. */
const FOOTER_SPACE = 40

// ── Font metrics ─────────────────────────────────────────────────────────
// Advance widths for Helvetica / Helvetica-Bold in 1/1000 em, for the printable
// ASCII range. Real metrics (not an approximation) so wrapping matches what a
// reader actually renders — a guessed average width leaves visibly ragged or
// overflowing lines.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

/**
 * Characters outside ASCII that the app actually emits, mapped to their
 * WinAnsiEncoding byte and advance width. Everything else non-ASCII becomes a
 * question mark — a garbled glyph is worse than an honest placeholder.
 *
 * The em dash matters most: it's the delimiter Pulse uses everywhere.
 */
const WIN_ANSI_EXTRAS: Record<string, { byte: number; width: number; boldWidth: number }> = {
  '—': { byte: 0x97, width: 1000, boldWidth: 1000 },
  '–': { byte: 0x96, width: 556, boldWidth: 556 },
  '‘': { byte: 0x91, width: 222, boldWidth: 278 },
  '’': { byte: 0x92, width: 222, boldWidth: 278 },
  '“': { byte: 0x93, width: 333, boldWidth: 500 },
  '”': { byte: 0x94, width: 333, boldWidth: 500 },
  '…': { byte: 0x85, width: 1000, boldWidth: 1000 },
  '·': { byte: 0xb7, width: 278, boldWidth: 278 },
  '•': { byte: 0x95, width: 350, boldWidth: 350 },
  '€': { byte: 0x80, width: 556, boldWidth: 556 },
  '™': { byte: 0x99, width: 1000, boldWidth: 1000 },
  '©': { byte: 0xa9, width: 737, boldWidth: 737 },
}

function charWidth(char: string, bold: boolean): number {
  const code = char.charCodeAt(0)
  if (code >= 32 && code <= 126) {
    return (bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS)[code - 32]
  }
  const extra = WIN_ANSI_EXTRAS[char]
  if (extra) return bold ? extra.boldWidth : extra.width
  // Unrenderable → '?'
  return (bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS)['?'.charCodeAt(0) - 32]
}

/** Width of a string at a given size, in points. */
function textWidth(text: string, size: number, bold: boolean): number {
  let total = 0
  for (const char of text) total += charWidth(char, bold)
  return (total * size) / 1000
}

/**
 * Encode a string as a PDF literal string in WinAnsiEncoding, escaping the
 * three characters that would otherwise terminate or nest the literal.
 */
function pdfString(text: string): Buffer {
  const bytes: number[] = []
  for (const char of text) {
    const code = char.charCodeAt(0)
    let byte: number
    if (code >= 32 && code <= 126) byte = code
    else if (WIN_ANSI_EXTRAS[char]) byte = WIN_ANSI_EXTRAS[char].byte
    else byte = 0x3f // '?'
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c) // ( ) \
    bytes.push(byte)
  }
  return Buffer.from(bytes)
}

// ── Document model ───────────────────────────────────────────────────────

export type PdfBlock =
  /** A section heading. Slightly larger, bold, with space above. */
  | { kind: 'heading'; text: string; level?: 1 | 2 }
  /** Flowed body text, wrapped to the content width. */
  | { kind: 'text'; text: string; bold?: boolean; size?: number; muted?: boolean; indent?: number }
  /** A label/value row — label in grey, value flowed beneath or beside it. */
  | { kind: 'field'; label: string; value: string }
  /** A full-width hairline. */
  | { kind: 'rule' }
  /** Vertical whitespace, in points. */
  | { kind: 'space'; height: number }
  /** Force the next block onto a new page. */
  | { kind: 'pageBreak' }

export type PdfDocument = {
  title: string
  subtitle?: string
  /** Repeated at the bottom of every page, alongside the page number. */
  footer?: string
  blocks: PdfBlock[]
}

const COLORS = {
  text: '0.11 0.13 0.18',
  muted: '0.45 0.49 0.58',
  accent: '0.545 0.361 0.965', // Pulse violet
  rule: '0.85 0.87 0.9',
}

type Cursor = {
  /** Content-stream operators for the page being built. */
  ops: string[]
  /** Distance from the top of the page to the next baseline. */
  y: number
}

/**
 * Render a document to PDF bytes.
 *
 * Layout is single-pass and top-down: each block emits its operators at the
 * current cursor and advances it, starting a new page when it would run into
 * the footer. That's enough for a report and keeps the whole thing readable.
 */
export function renderPdf(doc: PdfDocument): Buffer {
  const pages: string[] = []
  let cursor: Cursor = { ops: [], y: MARGIN }

  const finishPage = () => {
    if (cursor.ops.length > 0) pages.push(cursor.ops.join('\n'))
    cursor = { ops: [], y: MARGIN }
  }

  /** Room for `height` more points on this page? */
  const ensureSpace = (height: number) => {
    if (cursor.y + height > PAGE_HEIGHT - MARGIN - FOOTER_SPACE) {
      finishPage()
      // Continuation pages skip the title block; the header only appears once.
      cursor.y = MARGIN
    }
  }

  /** Draw one already-wrapped line and advance the cursor. */
  const drawLine = (
    text: string,
    opts: { size: number; bold: boolean; color: string; indent: number; leading: number },
  ) => {
    ensureSpace(opts.leading)
    const baseline = PAGE_HEIGHT - cursor.y - opts.size
    cursor.ops.push(
      `BT /${opts.bold ? 'F2' : 'F1'} ${opts.size} Tf ${opts.color} rg 1 0 0 1 ${(MARGIN + opts.indent).toFixed(2)} ${baseline.toFixed(2)} Tm (${pdfString(text).toString('latin1')}) Tj ET`,
    )
    cursor.y += opts.leading
  }

  /** Break a string into lines that fit the content width. */
  const wrap = (text: string, size: number, bold: boolean, indent: number): string[] => {
    const maxWidth = CONTENT_WIDTH - indent
    const lines: string[] = []
    for (const paragraph of text.split('\n')) {
      const words = paragraph.split(/\s+/).filter(Boolean)
      if (words.length === 0) {
        lines.push('')
        continue
      }
      let line = ''
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word
        if (textWidth(candidate, size, bold) <= maxWidth) {
          line = candidate
          continue
        }
        if (line) lines.push(line)
        // A single word longer than the line (an id, a URL) is hard-split
        // rather than allowed to overflow the margin.
        if (textWidth(word, size, bold) > maxWidth) {
          let chunk = ''
          for (const char of word) {
            if (textWidth(chunk + char, size, bold) > maxWidth) {
              lines.push(chunk)
              chunk = char
            } else {
              chunk += char
            }
          }
          line = chunk
        } else {
          line = word
        }
      }
      if (line) lines.push(line)
    }
    return lines
  }

  const paragraph = (
    text: string,
    opts: { size?: number; bold?: boolean; color?: string; indent?: number } = {},
  ) => {
    const size = opts.size ?? 9.5
    const bold = opts.bold ?? false
    const indent = opts.indent ?? 0
    const leading = size * 1.35
    for (const line of wrap(text, size, bold, indent)) {
      drawLine(line, { size, bold, color: opts.color ?? COLORS.text, indent, leading })
    }
  }

  // ── Header (first page only) ───────────────────────────────────────────
  paragraph(doc.title, { size: 20, bold: true, color: COLORS.text })
  if (doc.subtitle) {
    cursor.y += 2
    paragraph(doc.subtitle, { size: 9.5, color: COLORS.muted })
  }
  cursor.y += 6
  drawRule(cursor, COLORS.accent, 1.2)
  cursor.y += 14

  for (const block of doc.blocks) {
    switch (block.kind) {
      case 'heading': {
        const size = block.level === 2 ? 11 : 13
        cursor.y += 10
        // Keep a heading with at least a couple of lines of what follows.
        ensureSpace(size * 1.35 + 28)
        paragraph(block.text, { size, bold: true })
        cursor.y += 2
        break
      }
      case 'text':
        paragraph(block.text, {
          size: block.size,
          bold: block.bold,
          color: block.muted ? COLORS.muted : COLORS.text,
          indent: block.indent,
        })
        break
      case 'field': {
        paragraph(block.label.toUpperCase(), { size: 7, bold: true, color: COLORS.muted })
        paragraph(block.value, { size: 9.5 })
        cursor.y += 3
        break
      }
      case 'rule':
        cursor.y += 6
        ensureSpace(8)
        drawRule(cursor, COLORS.rule, 0.6)
        cursor.y += 8
        break
      case 'space':
        cursor.y += block.height
        break
      case 'pageBreak':
        finishPage()
        break
    }
  }

  finishPage()
  if (pages.length === 0) pages.push('')

  return assemble(pages, doc.footer ?? '')
}

/** Emit a horizontal hairline at the cursor's current y. */
function drawRule(cursor: Cursor, color: string, thickness: number): void {
  const y = PAGE_HEIGHT - cursor.y
  cursor.ops.push(
    `${color} RG ${thickness} w ${MARGIN} ${y.toFixed(2)} m ${(PAGE_WIDTH - MARGIN).toFixed(2)} ${y.toFixed(2)} l S`,
  )
}

/**
 * Stitch the page content streams into a complete PDF file.
 *
 * Object numbering: 1 catalog, 2 page tree, 3 + 4 fonts, then two objects per
 * page (the page dict and its content stream). The xref table needs each
 * object's byte offset, so the body is built into a buffer list while the
 * offsets are recorded as we go.
 */
function assemble(pages: string[], footer: string): Buffer {
  const chunks: Buffer[] = []
  const offsets: number[] = []
  let length = 0

  const push = (text: string | Buffer) => {
    const buf = Buffer.isBuffer(text) ? text : Buffer.from(text, 'latin1')
    chunks.push(buf)
    length += buf.length
  }

  const addObject = (num: number, body: string | Buffer) => {
    offsets[num] = length
    push(`${num} 0 obj\n`)
    push(body)
    push('\nendobj\n')
  }

  push('%PDF-1.4\n')
  // A binary comment marks the file as containing binary data, which keeps
  // naive transports from mangling it.
  push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  const pageObjectNumbers = pages.map((_, i) => 5 + i * 2)

  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>')
  addObject(
    2,
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  )
  addObject(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  addObject(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

  pages.forEach((content, index) => {
    const pageNum = pageObjectNumbers[index]
    const streamNum = pageNum + 1

    // Page footer: the document's own footer on the left, "n / total" right.
    const label = `Page ${index + 1} of ${pages.length}`
    const footerY = MARGIN * 0.6
    const footerOps = [
      `BT /F1 7.5 Tf ${COLORS.muted} rg 1 0 0 1 ${MARGIN} ${footerY.toFixed(2)} Tm (${pdfString(footer).toString('latin1')}) Tj ET`,
      `BT /F1 7.5 Tf ${COLORS.muted} rg 1 0 0 1 ${(PAGE_WIDTH - MARGIN - textWidth(label, 7.5, false)).toFixed(2)} ${footerY.toFixed(2)} Tm (${pdfString(label).toString('latin1')}) Tj ET`,
    ].join('\n')

    const stream = Buffer.from(`${content}\n${footerOps}`, 'latin1')

    addObject(
      pageNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamNum} 0 R >>`,
    )

    offsets[streamNum] = length
    push(`${streamNum} 0 obj\n<< /Length ${stream.length} >>\nstream\n`)
    push(stream)
    push('\nendstream\nendobj\n')
  })

  const objectCount = 5 + pages.length * 2
  const xrefOffset = length

  let xref = `xref\n0 ${objectCount}\n0000000000 65535 f \n`
  for (let i = 1; i < objectCount; i++) {
    xref += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`
  }
  push(xref)
  push(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

  return Buffer.concat(chunks)
}
