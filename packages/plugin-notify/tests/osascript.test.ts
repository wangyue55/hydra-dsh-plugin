import { describe, expect, it } from 'vitest'
import { buildOsascriptArgs } from '../src/osascript.ts'

describe('buildOsascriptArgs', () => {
  it('builds a parameterized silent notification', () => {
    expect(buildOsascriptArgs({ title: 'T', body: 'B', sound: '' })).toEqual([
      '-e', 'on run argv',
      '-e', 'display notification (item 1 of argv) with title (item 2 of argv)',
      '-e', 'end run',
      '--', 'B', 'T',
    ])
  })

  it('appends the sound name when configured', () => {
    expect(buildOsascriptArgs({ title: 'T', body: 'B', sound: 'Glass' })).toEqual([
      '-e', 'on run argv',
      '-e', 'display notification (item 1 of argv) with title (item 2 of argv) sound name (item 3 of argv)',
      '-e', 'end run',
      '--', 'B', 'T', 'Glass',
    ])
  })

  it('passes hostile copy verbatim as argv, never into the script source', () => {
    const args = buildOsascriptArgs({ title: '"t" & (do shell script "true")', body: 'a\nb"', sound: '' })
    expect(args.slice(0, 7)).toEqual([
      '-e', 'on run argv',
      '-e', 'display notification (item 1 of argv) with title (item 2 of argv)',
      '-e', 'end run',
      '--',
    ])
    expect(args.slice(7)).toEqual(['a\nb"', '"t" & (do shell script "true")'])
  })

  it('keeps a dash-leading body as a positional via the -- terminator', () => {
    expect(buildOsascriptArgs({ title: 'T', body: '-e', sound: '' })).toEqual([
      '-e', 'on run argv',
      '-e', 'display notification (item 1 of argv) with title (item 2 of argv)',
      '-e', 'end run',
      '--', '-e', 'T',
    ])
  })
})
