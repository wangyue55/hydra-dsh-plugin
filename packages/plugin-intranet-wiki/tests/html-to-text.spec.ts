import { describe, expect, it } from 'vitest'
import { htmlToText } from '../src/html-to-text.ts'

describe('htmlToText', () => {
  it('strips tags while keeping block breaks, list markers, and cell bars', () => {
    const html = '<h1>Title</h1><p>One</p><ul><li>a</li><li>b</li></ul>'
      + '<table><tr><td>x</td><td>y</td></tr></table>'
    expect(htmlToText(html, { maxChars: 1000 }).text).toBe('Title\nOne\n- a\n- b\nx | y |')
  })

  it('drops script and style bodies entirely', () => {
    const html = '<p>keep</p><script>alert(1)</script><style>.a{}</style>'
    expect(htmlToText(html, { maxChars: 100 }).text).toBe('keep')
  })

  it('decodes named and numeric entities and <br> line breaks', () => {
    const html = 'a&nbsp;&amp;&lt;&gt;&quot;&#39;&#20013;<br>b'
    expect(htmlToText(html, { maxChars: 100 }).text).toBe('a &<>"\'中\nb')
  })

  it('collapses runs of blank lines and trailing spaces', () => {
    const html = '<p>a</p>\n\n\n\n<p>b   </p>\r'
    expect(htmlToText(html, { maxChars: 100 }).text).toBe('a\n\nb')
  })

  it('cuts at the budget and reports truncation, keeping an exact fit whole', () => {
    const over = htmlToText('<p>abcdef</p>', { maxChars: 5 })
    expect(over).toEqual({ text: 'abcde', truncated: true })
    const exact = htmlToText('<p>abcde</p>', { maxChars: 5 })
    expect(exact).toEqual({ text: 'abcde', truncated: false })
  })

  it('counts multibyte characters as single budget units', () => {
    const result = htmlToText('<p>中文内容超出预算</p>', { maxChars: 4 })
    expect(result.text).toBe('中文内容')
    expect(result.truncated).toBe(true)
  })
})
