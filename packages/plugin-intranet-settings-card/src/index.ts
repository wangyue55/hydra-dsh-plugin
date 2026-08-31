/**
 * Host half of the intranet credentials card: serves the `intranet` settings
 * namespace so the Plugins settings tab renders the card, and names the four
 * credential references the card addresses. Credential values never enter
 * this section — the browser half writes them through the credentials domain.
 * Named exports preserve loader injection metadata.
 * @module @hydra-dsh/plugin-intranet-settings-card
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the ctx.settings Context merge; the service value comes
// from the composed settings provider at runtime.
import type {} from '@deepseek-ai/dsh-settings'

export const name = 'ui-settings-intranet'
export const inject: string[] = []

/** Settings namespace the card is keyed on. */
export const INTRANET_NS = 'intranet'

/**
 * The credential references the card addresses. The defaults mirror the
 * intranet tool packages' defaults; a deployment that renames a reference in
 * a tool config states the same name here so the card edits the right key.
 */
export interface Config {
  /** Credential reference naming the wiki API base URL. */
  wikiBaseUrlEnv?: string
  /** Credential reference naming the wiki bearer token. */
  wikiTokenEnv?: string
  /** Credential reference naming the GitLab API base URL. */
  gitlabBaseUrlEnv?: string
  /** Credential reference naming the GitLab private token. */
  gitlabTokenEnv?: string
}

/** Schemastery configuration for the intranet credentials card. */
export const Config: z<Config> = z.object({
  wikiBaseUrlEnv: z.string().role('credential-ref').default('INTRANET_WIKI_BASE_URL'),
  wikiTokenEnv: z.string().role('credential-ref').default('INTRANET_WIKI_TOKEN'),
  gitlabBaseUrlEnv: z.string().role('credential-ref').default('INTRANET_GITLAB_BASE_URL'),
  gitlabTokenEnv: z.string().role('credential-ref').default('INTRANET_GITLAB_TOKEN'),
})

/**
 * Register the `intranet` settings section. The section is served through the
 * settings seam when one is composed; without one the plugin stays inert.
 * @param ctx - registrant context; the settings seam is consumed when composed.
 * @param config - deployment's reference names.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, INTRANET_NS, Config, config, {
      // The section only names references; nothing here derives from the live
      // value, so the source and change hooks have no work.
      setSource: () => {},
      onChange: () => {},
    })
  })
}
