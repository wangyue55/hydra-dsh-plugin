/**
 * Markdown-to-Confluence-storage rendering for wiki write-backs. Ported from
 * the hydra-agent renderer: a line-oriented subset covering headings,
 * paragraphs, flat lists, pipe tables, fenced code, and inline code / bold /
 * links, with emoji stripped because the target wiki rejects them.
 * @module @hydra-dsh/plugin-intranet-wiki/src/wiki-storage-renderer
 */

/**
 * Render Markdown to Confluence storage-format XHTML.
 * @param markdown - full Markdown document.
 * @returns storage-format markup with no surrounding whitespace.
 */
export function markdownToWikiStorage(markdown: string): string {
  const lines = sanitizeWikiText(markdown).split(/\r?\n/)
  const html: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let tableRows: string[][] = []
  let codeOpen = false
  let codeLines: string[] = []

  const flushList = (): void => {
    if (!listType) return
    html.push(`</${listType}>`)
    listType = null
  }

  const flushTable = (): void => {
    if (tableRows.length === 0) return
    html.push('<table><tbody>')
    tableRows.forEach((row, index) => {
      const tag = index === 0 ? 'th' : 'td'
      html.push(
        `<tr>${row.map(cell => `<${tag}>${renderInlineMarkdown(cell.trim())}</${tag}>`).join('')}</tr>`,
      )
    })
    html.push('</tbody></table>')
    tableRows = []
  }

  const flushCode = (): void => {
    if (!codeOpen) return
    html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    codeOpen = false
    codeLines = []
  }

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (codeOpen) {
        flushCode()
      } else {
        flushList()
        flushTable()
        codeOpen = true
        codeLines = []
      }
      continue
    }

    if (codeOpen) {
      codeLines.push(line)
      continue
    }

    const tableCells = parseMarkdownTableRow(line)
    if (tableCells) {
      flushList()
      if (!tableCells.every(cell => /^:?-{3,}:?$/.test(cell.trim()))) {
        tableRows.push(tableCells)
      }
      continue
    }

    flushTable()

    if (!line.trim()) {
      flushList()
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    const hashes = heading?.[1]
    const headingText = heading?.[2]
    if (hashes !== undefined && headingText !== undefined) {
      flushList()
      const level = hashes.length
      html.push(`<h${level}>${renderInlineMarkdown(headingText)}</h${level}>`)
      continue
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/)?.[1]
    if (unordered !== undefined) {
      if (listType !== 'ul') {
        flushList()
        listType = 'ul'
        html.push('<ul>')
      }
      html.push(`<li>${renderInlineMarkdown(unordered)}</li>`)
      continue
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/)?.[1]
    if (ordered !== undefined) {
      if (listType !== 'ol') {
        flushList()
        listType = 'ol'
        html.push('<ol>')
      }
      html.push(`<li>${renderInlineMarkdown(ordered)}</li>`)
      continue
    }

    flushList()
    html.push(`<p>${renderInlineMarkdown(line)}</p>`)
  }

  flushCode()
  flushList()
  flushTable()

  return html.join('')
}

/**
 * Summarize a Markdown document as its heading lines, falling back to its
 * first non-empty lines when it has no headings.
 * @param markdown - full Markdown document.
 * @param maxItems - maximum summary entries.
 * @returns up to `maxItems` summary lines.
 */
export function summarizeMarkdown(markdown: string, maxItems = 8): string[] {
  const sanitized = sanitizeWikiText(markdown)
  const headings = sanitized
    .split(/\r?\n/)
    .map(line => line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim())
    .filter((value): value is string => !!value)
  if (headings.length > 0) return headings.slice(0, maxItems)

  return sanitized
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

/**
 * Strip emoji, keycap sequences, and variation selectors the target wiki's
 * storage format rejects.
 * @param value - candidate text.
 * @returns the text with rejected code points removed.
 */
export function sanitizeWikiText(value: string): string {
  return value
    .replace(/[0-9#*]\uFE0F?\u20E3/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\uFE0F\u200D\u20E3]/g, '')
}

/** Split a `|`-delimited table row into cells, or `null` for a non-row line. */
function parseMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null
  return trimmed.slice(1, -1).split('|').map(cell => cell.trim())
}

/** Render inline code, bold, and absolute links after HTML-escaping. */
function renderInlineMarkdown(value: string): string {
  let text = escapeHtml(value)
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>')
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
  return text
}

/**
 * Escape `&`, `<`, and `>` for storage-format text nodes.
 * @param value - raw text.
 * @returns the escaped text.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
