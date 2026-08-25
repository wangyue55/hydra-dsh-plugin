import { describe, expect, it } from 'vitest'
import { escapeHtml, markdownToWikiStorage, sanitizeWikiText, summarizeMarkdown } from '../src/wiki-storage-renderer.ts'

describe('markdownToWikiStorage', () => {
  it('renders headings, paragraphs, and inline code, bold, and links', () => {
    expect(markdownToWikiStorage('## Head\n\nplain `code` **bold** [x](https://a.example/b)')).toBe(
      '<h2>Head</h2><p>plain <code>code</code> <strong>bold</strong> <a href="https://a.example/b">x</a></p>',
    )
  })

  it('renders unordered and ordered lists and switches between them', () => {
    expect(markdownToWikiStorage('- a\n- b\n1. c\n2. d')).toBe(
      '<ul><li>a</li><li>b</li></ul><ol><li>c</li><li>d</li></ol>',
    )
  })

  it('closes an open list at a blank line and at a heading', () => {
    expect(markdownToWikiStorage('- a\n\ntext\n- b\n# H')).toBe(
      '<ul><li>a</li></ul><p>text</p><ul><li>b</li></ul><h1>H</h1>',
    )
  })

  it('renders pipe tables with a header row and drops the separator row', () => {
    expect(markdownToWikiStorage('| A | B |\n| --- | :---: |\n| 1 | 2 |')).toBe(
      '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>',
    )
  })

  it('flushes an open table when prose follows it', () => {
    expect(markdownToWikiStorage('| A |\n| --- |\ntext')).toBe(
      '<table><tbody><tr><th>A</th></tr></tbody></table><p>text</p>',
    )
  })

  it('keeps fenced code verbatim, escaped, and unparsed', () => {
    expect(markdownToWikiStorage('```\n- not a list\n<b>raw</b>\n```')).toBe(
      '<pre><code>- not a list\n&lt;b&gt;raw&lt;/b&gt;</code></pre>',
    )
  })

  it('closes an unterminated fence at end of input', () => {
    expect(markdownToWikiStorage('```\ntail')).toBe('<pre><code>tail</code></pre>')
  })

  it('interrupts a list with a fence and escapes markup in text nodes', () => {
    expect(markdownToWikiStorage('- item\n```\nx\n```\na & b < c')).toBe(
      '<ul><li>item</li></ul><pre><code>x</code></pre><p>a &amp; b &lt; c</p>',
    )
  })
})

describe('summarizeMarkdown', () => {
  it('prefers heading lines and caps them at maxItems', () => {
    expect(summarizeMarkdown('# A\ntext\n## B\n### C', 2)).toEqual(['A', 'B'])
  })

  it('falls back to the first non-empty lines when no headings exist', () => {
    expect(summarizeMarkdown('one\n\ntwo\nthree', 2)).toEqual(['one', 'two'])
  })
})

describe('sanitizeWikiText', () => {
  it('strips emoji, keycap sequences, and joiner residue', () => {
    expect(sanitizeWikiText('1️⃣ done \u{1F600} ok ✅')).toBe(' done  ok ')
  })

  it('keeps plain CJK and ASCII untouched', () => {
    expect(sanitizeWikiText('评审 review 100%')).toBe('评审 review 100%')
  })
})

describe('escapeHtml', () => {
  it('escapes the three storage-format metacharacters', () => {
    expect(escapeHtml('a & <b> > c')).toBe('a &amp; &lt;b&gt; &gt; c')
  })
})
