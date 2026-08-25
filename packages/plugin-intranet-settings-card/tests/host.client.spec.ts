/** The Host half serves the `intranet` namespace and leaves with its fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as HostHalf from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-settings-intranet host', () => {
  it('serves the reference names with their defaults and disposes with the fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin(HostHalf, {})
    await fiber.await()
    const ns = settingsNamespace('intranet')
    expect(ctx.settings.get(ns)).toEqual({
      wikiBaseUrlEnv: 'INTRANET_WIKI_BASE_URL',
      wikiTokenEnv: 'INTRANET_WIKI_TOKEN',
      gitlabBaseUrlEnv: 'INTRANET_GITLAB_BASE_URL',
      gitlabTokenEnv: 'INTRANET_GITLAB_TOKEN',
    })
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('layers a composition entry naming other references under the user document', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(HostHalf, { wikiTokenEnv: 'INTERNAL_WIKI_TOKEN' }).await()
    const ns = settingsNamespace('intranet')
    expect(ctx.settings.get(ns)).toMatchObject({ wikiTokenEnv: 'INTERNAL_WIKI_TOKEN' })
    await ctx.settings.update(ns, { wikiTokenEnv: 'ANOTHER_TOKEN_REF' })
    expect(ctx.settings.get(ns)).toMatchObject({ wikiTokenEnv: 'ANOTHER_TOKEN_REF' })
  })

  it('stays mountable without a settings provider', async () => {
    const ctx = new Context()
    await ctx.plugin(HostHalf, {}).await()
    expect(ctx.get('settings')).toBeUndefined()
  })
})
