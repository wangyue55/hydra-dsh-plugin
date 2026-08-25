import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { formatDuration, formatNotification } from '../src/format.ts'

describe('formatDuration', () => {
  it('renders sub-minute as seconds', () => {
    expect(formatDuration(42_000)).toBe('42s')
  })
  it('rounds up across the minute boundary', () => {
    expect(formatDuration(59_999)).toBe('1m00s')
  })
  it('zero-pads seconds past a minute', () => {
    expect(formatDuration(185_000)).toBe('3m05s')
  })
  it('renders the exact minute boundary', () => {
    expect(formatDuration(60_000)).toBe('1m00s')
  })
})

describe('formatNotification', () => {
  it('formats completed with duration', () => {
    expect(formatNotification({ kind: 'completed' }, 42_000)).toEqual({
      title: '✅ dsh · 任务完成',
      body: '耗时 42s',
    })
  })

  it('omits duration when the start was never seen', () => {
    expect(formatNotification({ kind: 'completed' })).toEqual({
      title: '✅ dsh · 任务完成',
      body: '',
    })
  })

  it('formats max-tokens', () => {
    expect(formatNotification({ kind: 'max-tokens' }, 42_000)).toEqual({
      title: '⚠️ dsh · 达到输出上限',
      body: '耗时 42s',
    })
  })

  it('appends the first error line, clipped to 80 chars', () => {
    const message = `${'x'.repeat(90)}\nsecond line`
    const reason = { kind: 'error', error: { message, code: 'UNKNOWN' } } as TurnEndReason
    expect(formatNotification(reason, 42_000)).toEqual({
      title: '❌ dsh · 任务出错',
      body: `耗时 42s · ${'x'.repeat(80)}…`,
    })
  })

  it('clips by code points, never splitting surrogate pairs', () => {
    // 'a' 让第 80 个 UTF-16 单元落在代理对中间：朴素 slice 会产出孤立代理项。
    const reason = { kind: 'error', error: { message: `a${'💥'.repeat(85)}`, code: 'UNKNOWN' } } as TurnEndReason
    const text = formatNotification(reason)
    expect(text).toEqual({
      title: '❌ dsh · 任务出错',
      body: `a${'💥'.repeat(79)}…`,
    })
  })

  it('uses the error line alone when duration is unknown', () => {
    const reason = { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } as TurnEndReason
    expect(formatNotification(reason)).toEqual({
      title: '❌ dsh · 任务出错',
      body: 'boom',
    })
  })

  it('keeps an exactly-80-char line unclipped and clips at 81', () => {
    const at80 = { kind: 'error', error: { message: 'x'.repeat(80), code: 'UNKNOWN' } } as TurnEndReason
    expect(formatNotification(at80)!.body).toBe('x'.repeat(80))
    const at81 = { kind: 'error', error: { message: 'x'.repeat(81), code: 'UNKNOWN' } } as TurnEndReason
    expect(formatNotification(at81)!.body).toBe(`${'x'.repeat(80)}…`)
  })

  it('drops the separator when the error message is empty', () => {
    const reason = { kind: 'error', error: { message: '', code: 'UNKNOWN' } } as TurnEndReason
    expect(formatNotification(reason, 42_000)).toEqual({ title: '❌ dsh · 任务出错', body: '耗时 42s' })
  })

  it.each(['aborted', 'interrupted', 'blocked', 'some-future-kind'])(
    'stays silent for %s',
    (kind) => {
      expect(formatNotification({ kind } as never)).toBeNull()
    },
  )
})
