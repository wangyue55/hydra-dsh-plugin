/** Controller behavior over a fake scope and a fake credentials domain. */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { IntranetCardController } from '../src/client/intranet-card-controller.ts'
import type { IntranetSettings } from '../src/client/intranet-card-controller.ts'

// 发布版 client-runtime 的 ./client 是浏览器闭包工厂制品（无 Node 可用导出），
// 这里以最小忠实桩替换 createSnapshotStore（useSyncExternalStore 契约）。
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: <T,>(initial: T) => {
    let current = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => current,
      set: (next: T) => {
        current = next
        listeners.forEach((listener) => { listener() })
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
  },
}))

type Describe = (input: { refs: string[] }) => Promise<{
  rpcId: string
  result:
    | { ok: true; value: { credentials: Record<string, { configured: boolean; writable: boolean } | undefined> } }
    | { ok: false; error: Record<string, never> }
}>

function fakeScope(value: IntranetSettings = {}) {
  const listeners = new Set<() => void>()
  let current = value
  return {
    scope: {
      getSnapshot: () => ({ value: current }) as SettingsScopeSnapshot<IntranetSettings>,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    } as unknown as SettingsScope<IntranetSettings>,
    rename: (next: IntranetSettings) => {
      current = next
      listeners.forEach((listener) => { listener() })
    },
  }
}

function okDescribe(configured: string[] = [], unwritable: string[] = []): Describe {
  return refsInput => Promise.resolve({
    rpcId: 'c',
    result: {
      ok: true,
      value: {
        credentials: Object.fromEntries(refsInput.refs.map(ref => [ref, {
          configured: configured.includes(ref),
          writable: !unwritable.includes(ref),
        }])),
      },
    },
  })
}

async function settle(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

describe('IntranetCardController', () => {
  it('addresses the default references and reports described state', async () => {
    const { scope } = fakeScope()
    const describeCredentials = vi.fn(okDescribe(['INTRANET_WIKI_TOKEN'], ['INTRANET_GITLAB_TOKEN']))
    const controller = new IntranetCardController(scope, { credentials: { describe: describeCredentials, set: vi.fn() } } as never)
    await settle()
    const state = controller.inject().hooks.intranetCard.getSnapshot()
    expect(describeCredentials).toHaveBeenCalledWith({
      refs: ['INTRANET_WIKI_BASE_URL', 'INTRANET_WIKI_TOKEN', 'INTRANET_GITLAB_BASE_URL', 'INTRANET_GITLAB_TOKEN'],
    })
    expect(state.fields.wikiToken).toMatchObject({ ref: 'INTRANET_WIKI_TOKEN', configured: true, writable: true })
    expect(state.fields.gitlabToken).toMatchObject({ configured: false, writable: false })
    expect(state.dirty).toBe(false)
  })

  it('follows section-named references and re-describes on a rename', async () => {
    const { scope, rename } = fakeScope({ wikiTokenEnv: 'INTERNAL_WIKI_TOKEN' })
    const describeCredentials = vi.fn(okDescribe(['INTERNAL_WIKI_TOKEN']))
    const controller = new IntranetCardController(scope, { credentials: { describe: describeCredentials, set: vi.fn() } } as never)
    await settle()
    expect(controller.inject().hooks.intranetCard.getSnapshot().fields.wikiToken)
      .toMatchObject({ ref: 'INTERNAL_WIKI_TOKEN', configured: true })
    rename({ wikiTokenEnv: 'THIRD_REF' })
    await settle()
    const lastCall = describeCredentials.mock.calls.at(-1)?.[0]
    expect(lastCall?.refs).toContain('THIRD_REF')
  })

  it('stages drafts, saves them through credentials.set, and clears on success', async () => {
    const { scope } = fakeScope()
    const set = vi.fn((_input: { ref: string; value: string }) => Promise.resolve({ rpcId: 's', result: { ok: true, value: {} } }))
    const controller = new IntranetCardController(scope, { credentials: { describe: okDescribe(), set } } as never)
    await settle()
    const face = controller.inject()
    face.edit('wikiBaseUrl', 'https://wiki.example')
    face.edit('wikiToken', 'secret')
    expect(face.hooks.intranetCard.getSnapshot().dirty).toBe(true)
    await face.save()
    expect(set.mock.calls.map(call => call[0])).toEqual([
      { ref: 'INTRANET_WIKI_BASE_URL', value: 'https://wiki.example' },
      { ref: 'INTRANET_WIKI_TOKEN', value: 'secret' },
    ])
    const state = face.hooks.intranetCard.getSnapshot()
    expect(state.dirty).toBe(false)
    expect(state.saving).toBe(false)
    expect(state.saveFailed).toBe(false)
  })

  it('keeps a failed draft staged and reports the failure', async () => {
    const { scope } = fakeScope()
    const set = vi.fn((input: { ref: string }) => (input.ref === 'INTRANET_WIKI_TOKEN'
      ? Promise.reject(new Error('refused'))
      : Promise.resolve({ rpcId: 's', result: { ok: true, value: {} } })))
    const controller = new IntranetCardController(scope, { credentials: { describe: okDescribe(), set } } as never)
    await settle()
    const face = controller.inject()
    face.edit('wikiBaseUrl', 'https://wiki.example')
    face.edit('wikiToken', 'secret')
    await face.save()
    const state = face.hooks.intranetCard.getSnapshot()
    expect(state.saveFailed).toBe(true)
    expect(state.fields.wikiBaseUrl.text).toBe('')
    expect(state.fields.wikiToken.text).toBe('secret')
    face.discard()
    const cleared = face.hooks.intranetCard.getSnapshot()
    expect(cleared.dirty).toBe(false)
    expect(cleared.saveFailed).toBe(false)
  })

  it('re-reads only for watched references and tolerates failed reads', async () => {
    const { scope } = fakeScope()
    const describeCredentials = vi.fn(okDescribe())
    const controller = new IntranetCardController(scope, { credentials: { describe: describeCredentials, set: vi.fn() } } as never)
    await settle()
    const calls = describeCredentials.mock.calls.length
    controller.refreshCredential('UNRELATED_REF')
    await settle()
    expect(describeCredentials.mock.calls.length).toBe(calls)
    controller.refreshCredential('INTRANET_GITLAB_BASE_URL')
    await settle()
    expect(describeCredentials.mock.calls.length).toBe(calls + 1)

    const failing = vi.fn(() => Promise.reject(new Error('offline')))
    const offline = new IntranetCardController(fakeScope().scope, { credentials: { describe: failing, set: vi.fn() } } as never)
    await settle()
    expect(offline.inject().hooks.intranetCard.getSnapshot().fields.wikiBaseUrl.writable).toBe(true)
  })

  it('ignores a re-entrant save while one is in flight', async () => {
    const { scope } = fakeScope()
    let releaseWrite: (() => void) | undefined
    const set = vi.fn(() => new Promise((resolve) => {
      releaseWrite = () => { resolve({ rpcId: 's', result: { ok: true, value: {} } }) }
    }))
    const controller = new IntranetCardController(scope, { credentials: { describe: okDescribe(), set } } as never)
    await settle()
    const face = controller.inject()
    face.edit('wikiToken', 'secret')
    const first = face.save()
    await settle()
    await face.save()
    expect(set).toHaveBeenCalledTimes(1)
    releaseWrite?.()
    await first
    expect(face.hooks.intranetCard.getSnapshot().saving).toBe(false)
  })

  it('ignores a non-ok describe answer', async () => {
    const { scope } = fakeScope()
    const describeCredentials = vi.fn(() => Promise.resolve({ rpcId: 'c', result: { ok: false as const, error: {} } }))
    const controller = new IntranetCardController(scope, { credentials: { describe: describeCredentials, set: vi.fn() } } as never)
    await settle()
    expect(controller.inject().hooks.intranetCard.getSnapshot().fields.wikiToken.configured).toBe(false)
  })

  it('drops a stale describe answer that settles after a rename', async () => {
    const { scope, rename } = fakeScope()
    let releaseFirst: (() => void) | undefined
    const answers: Describe = refsInput => (refsInput.refs.includes('LATE_REF')
      ? okDescribe(['LATE_REF'])(refsInput)
      : new Promise((resolve) => {
        releaseFirst = () => { void okDescribe(['INTRANET_WIKI_BASE_URL'])(refsInput).then(resolve) }
      }))
    const controller = new IntranetCardController(scope, { credentials: { describe: answers, set: vi.fn() } } as never)
    rename({ wikiBaseUrlEnv: 'LATE_REF' })
    await settle()
    releaseFirst?.()
    await settle()
    const state = controller.inject().hooks.intranetCard.getSnapshot()
    // The stale first answer (for the default reference) must not overwrite
    // the current reference's view.
    expect(state.fields.wikiBaseUrl.ref).toBe('LATE_REF')
    expect(state.fields.wikiBaseUrl.configured).toBe(true)
  })
})
