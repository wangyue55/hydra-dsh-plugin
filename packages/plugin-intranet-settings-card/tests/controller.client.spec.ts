/** Controller behavior over a fake scope and a fake credentials domain. */

import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { IntranetCardController } from '../src/client/intranet-card-controller.ts'
import type { IntranetSettings } from '../src/client/intranet-card-controller.ts'

type Describe = (refs: string[]) => Promise<
  | { ok: true; value: Record<string, { configured: boolean; writable: boolean } | undefined> }
  | { ok: false; error: Record<string, never> }
>

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
  return refs => Promise.resolve({
    ok: true,
    value: Object.fromEntries(refs.map(ref => [ref, {
      configured: configured.includes(ref),
      writable: !unwritable.includes(ref),
    }])),
  })
}

/** 假 ctx：只实现控制器用到的 `remote.credentials` 面。 */
function fakeCtx(credentials: { describe: unknown; set: unknown }): ClientContext {
  return { remote: { credentials } } as unknown as ClientContext
}

async function settle(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

describe('IntranetCardController', () => {
  it('addresses the default references and reports described state', async () => {
    const { scope } = fakeScope()
    const describeCredentials = vi.fn(okDescribe(['INTRANET_WIKI_TOKEN'], ['INTRANET_GITLAB_TOKEN']))
    const controller = new IntranetCardController(scope, fakeCtx({ describe: describeCredentials, set: vi.fn() }))
    await settle()
    const state = controller.inject().hooks.intranetCard.getSnapshot()
    expect(describeCredentials).toHaveBeenCalledWith([
      'INTRANET_WIKI_BASE_URL', 'INTRANET_WIKI_TOKEN', 'INTRANET_GITLAB_BASE_URL', 'INTRANET_GITLAB_TOKEN',
    ])
    expect(state.fields.wikiToken).toMatchObject({ ref: 'INTRANET_WIKI_TOKEN', configured: true, writable: true })
    expect(state.fields.gitlabToken).toMatchObject({ configured: false, writable: false })
    expect(state.dirty).toBe(false)
  })

  it('follows section-named references and re-describes on a rename', async () => {
    const { scope, rename } = fakeScope({ wikiTokenEnv: 'INTERNAL_WIKI_TOKEN' })
    const describeCredentials = vi.fn(okDescribe(['INTERNAL_WIKI_TOKEN']))
    const controller = new IntranetCardController(scope, fakeCtx({ describe: describeCredentials, set: vi.fn() }))
    await settle()
    expect(controller.inject().hooks.intranetCard.getSnapshot().fields.wikiToken)
      .toMatchObject({ ref: 'INTERNAL_WIKI_TOKEN', configured: true })
    rename({ wikiTokenEnv: 'THIRD_REF' })
    await settle()
    const lastCall = describeCredentials.mock.calls.at(-1)?.[0]
    expect(lastCall).toContain('THIRD_REF')
  })

  it('stages drafts, saves them through credentials.set, and clears on success', async () => {
    const { scope } = fakeScope()
    const set = vi.fn((_ref: string, _value: string) => Promise.resolve({ ok: true }))
    const controller = new IntranetCardController(scope, fakeCtx({ describe: okDescribe(), set }))
    await settle()
    const face = controller.inject()
    face.edit('wikiBaseUrl', 'https://wiki.example')
    face.edit('wikiToken', 'secret')
    expect(face.hooks.intranetCard.getSnapshot().dirty).toBe(true)
    await face.save()
    expect(set.mock.calls.map(call => call[0])).toEqual([
      'INTRANET_WIKI_BASE_URL',
      'INTRANET_WIKI_TOKEN',
    ])
    const state = face.hooks.intranetCard.getSnapshot()
    expect(state.dirty).toBe(false)
    expect(state.saving).toBe(false)
    expect(state.saveFailed).toBe(false)
  })

  it('keeps a failed draft staged and reports the failure', async () => {
    const { scope } = fakeScope()
    const set = vi.fn((ref: string) => (ref === 'INTRANET_WIKI_TOKEN'
      ? Promise.reject(new Error('refused'))
      : Promise.resolve({ ok: true })))
    const controller = new IntranetCardController(scope, fakeCtx({ describe: okDescribe(), set }))
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
    const controller = new IntranetCardController(scope, fakeCtx({ describe: describeCredentials, set: vi.fn() }))
    await settle()
    const calls = describeCredentials.mock.calls.length
    controller.refreshCredential('UNRELATED_REF')
    await settle()
    expect(describeCredentials.mock.calls.length).toBe(calls)
    controller.refreshCredential('INTRANET_GITLAB_BASE_URL')
    await settle()
    expect(describeCredentials.mock.calls.length).toBe(calls + 1)

    const failing = vi.fn(() => Promise.reject(new Error('offline')))
    const offline = new IntranetCardController(fakeScope().scope, fakeCtx({ describe: failing, set: vi.fn() }))
    await settle()
    expect(offline.inject().hooks.intranetCard.getSnapshot().fields.wikiBaseUrl.writable).toBe(true)
  })

  it('ignores a re-entrant save while one is in flight', async () => {
    const { scope } = fakeScope()
    let releaseWrite: (() => void) | undefined
    const set = vi.fn(() => new Promise((resolve) => {
      releaseWrite = () => { resolve({ ok: true }) }
    }))
    const controller = new IntranetCardController(scope, fakeCtx({ describe: okDescribe(), set }))
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
    const describeCredentials = vi.fn(() => Promise.resolve({ ok: false as const, error: {} }))
    const controller = new IntranetCardController(scope, fakeCtx({ describe: describeCredentials, set: vi.fn() }))
    await settle()
    expect(controller.inject().hooks.intranetCard.getSnapshot().fields.wikiToken.configured).toBe(false)
  })

  it('drops a stale describe answer that settles after a rename', async () => {
    const { scope, rename } = fakeScope()
    let releaseFirst: (() => void) | undefined
    const answers: Describe = refs => (refs.includes('LATE_REF')
      ? okDescribe(['LATE_REF'])(refs)
      : new Promise((resolve) => {
        releaseFirst = () => { void okDescribe(['INTRANET_WIKI_BASE_URL'])(refs).then(resolve) }
      }))
    const controller = new IntranetCardController(scope, fakeCtx({ describe: answers, set: vi.fn() }))
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
