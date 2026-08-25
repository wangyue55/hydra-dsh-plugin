/**
 * Lossy Confluence-HTML-to-text conversion for model consumption. Ported from
 * the hydra-agent converter: tag stripping with line-break preservation for
 * block elements, list and table markers, and a hard character budget.
 * @module @hydra-dsh/plugin-intranet-wiki/src/html-to-text
 */

/** Conversion options; the budget is caller-resolved and mandatory. */
export interface HtmlToTextOptions {
  /** Hard output budget in characters; longer text is cut and flagged. */
  maxChars: number
}

/**
 * Strip an HTML body to readable plain text within a character budget.
 * @param html - storage- or view-format HTML.
 * @param options - resolved conversion budget.
 * @returns the text and whether the budget cut it short.
 */
export function htmlToText(html: string, options: HtmlToTextOptions): {
  text: string
  truncated: boolean
} {
  const maxChars = options.maxChars
  let text = html

  text = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const truncated = text.length > maxChars
  if (truncated) text = text.slice(0, maxChars)

  return { text, truncated }
}
