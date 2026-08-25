import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliverNotification } from '../src/osascript.ts'
import { Config, apply } from '../src/index.ts'

vi.mock('../src/osascript.ts', () => ({
  deliverNotification: vi.fn(() => Promise.resolve()),
}))

const deliverMock = vi.mocked(deliverNotification)

type Listener = (session: unknown, event: unknown) => void

/** 捕获 ctx.on 注册的假上下文；只实现本插件用到的面。 */
function mount(config?: { sound: string }) {
  const listeners = new Map<string, Listener>()
  const ctx = {
    on: (name: string, listener: Listener) => {
      listeners.set(name, listener)
    },
  }
  apply(ctx as unknown as Context, Config(config))
  return listeners
}

function withPlatform(platform: string, run: () => void) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    run()
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
}

const session = { id: 'session-1' }

function turnStart(time: number) {
  return { type: 'turn/start', seq: 1, time, data: { turn: 1 } }
}

function turnEnd(time: number, reason: unknown) {
  return { type: 'turn/end', seq: 2, time, data: { turn: 1, reason } }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('apply', () => {
  it('registers nothing and warns once off macOS', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    withPlatform('linux', () => {
      const listeners = mount()
      expect(listeners.size).toBe(0)
    })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('notifies a completed turn with event-time duration and cleans the start map', () => {
    withPlatform('darwin', () => {
      const listeners = mount()
      const listener = listeners.get('session/event')!
      listener(session, turnStart(1_000))
      listener(session, turnEnd(43_000, { kind: 'completed' }))
      expect(deliverMock).toHaveBeenCalledWith({ title: '✅ dsh · 任务完成', body: '耗时 42s', sound: '' })
      // 起点已清除：同会话再来一个 turn/end，耗时未知，正文为空。
      listener(session, turnEnd(99_000, { kind: 'completed' }))
      expect(deliverMock).toHaveBeenLastCalledWith({ title: '✅ dsh · 任务完成', body: '', sound: '' })
    })
  })

  it('stays silent for aborted turns', () => {
    withPlatform('darwin', () => {
      const listeners = mount()
      const listener = listeners.get('session/event')!
      listener(session, turnStart(1_000))
      listener(session, turnEnd(2_000, { kind: 'aborted', reason: { kind: 'user' } }))
      expect(deliverMock).not.toHaveBeenCalled()
    })
  })

  it('threads the configured sound through', () => {
    withPlatform('darwin', () => {
      const listeners = mount({ sound: 'Glass' })
      listeners.get('session/event')!(session, turnEnd(2_000, { kind: 'completed' }))
      expect(deliverMock).toHaveBeenCalledWith({ title: '✅ dsh · 任务完成', body: '', sound: 'Glass' })
    })
  })

  it('warns on the first delivery failure only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    deliverMock.mockRejectedValue(new Error('denied'))
    withPlatform('darwin', () => {
      const listeners = mount()
      const listener = listeners.get('session/event')!
      listener(session, turnEnd(2_000, { kind: 'completed' }))
      listener(session, turnEnd(3_000, { kind: 'completed' }))
    })
    await vi.waitFor(() => {
      expect(deliverMock).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenCalledTimes(1)
    })
  })
})
