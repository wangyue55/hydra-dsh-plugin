/**
 * Intranet credentials card, browser half — one keyed entry in the Plugins
 * configuration tab. The card renders when the Host serves the `intranet`
 * settings namespace (this package's Host half registers it) and edits only
 * credential values, addressed by the references the section names.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.settingsScope Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the ctx.slots Context merge (the renderer owns the registry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the 'settings.plugin.item' SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the forwarded-event allowlist seat that types `$on` payloads.
import type {} from '@deepseek-ai/dsh-api-remotes/types'
// Type-only: the owner package's Events declaration `$on` hands to a listener
// (`credentials/reference-updated` payload). Imported directly because the
// api-remotes lib chain resolves peers from the pnpm virtual store, where the
// consumer-provided peer is not present.
import type {} from '@deepseek-ai/dsh-credentials/types'
import { IntranetCard } from './IntranetCard.tsx'
import { INTRANET_NS, IntranetCardController } from './intranet-card-controller.ts'
import type { IntranetSettings } from './intranet-card-controller.ts'
import { en, zh } from './locales.ts'
import type { IntranetSettingsLocaleKey } from './locales.ts'

export type {
  IntranetCardFace, IntranetCardState, IntranetFieldName, IntranetFieldState, IntranetSettings,
} from './intranet-card-controller.ts'
export type { IntranetCardProps } from './IntranetCard.tsx'
export type { IntranetSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Intranet credentials card copy. */
    'settings.intranet': IntranetSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.intranet'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'settingsScope']

/**
 * Mount the intranet credentials card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-intranet: card dictionaries')

  const controller = new IntranetCardController(
    ctx.settingsScope.bind<IntranetSettings>({ namespace: INTRANET_NS }),
    ctx,
  )

  // A credential written on another surface (the same references are plain
  // environment names) only announces itself through this forwarded event.
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref) => { controller.refreshCredential(ref) }),
    'ui-settings-intranet: credential invalidations',
  )

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: INTRANET_NS,
    locale: NS,
    inject: () => controller.inject(),
  }, IntranetCard))
}
