/**
 * The intranet credentials card's staged form over the credentials domain.
 *
 * No control lives in the settings section: the section only names the four
 * references, and every value is written through `credentials.set`, so a
 * literal never rides a settings response. Drafts stage locally; one save
 * writes them all, and the Host's re-described state is the only authority on
 * what is configured.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Namespace of the intranet credentials section. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const INTRANET_NS = 'intranet'

/** The four credential controls, keyed by their section reference field. */
export const INTRANET_FIELDS = ['wikiBaseUrl', 'wikiToken', 'gitlabBaseUrl', 'gitlabToken'] as const

/** One of the card's credential controls. */
export type IntranetFieldName = (typeof INTRANET_FIELDS)[number]

/** References addressed when the section names none. */
const DEFAULT_REFS: Record<IntranetFieldName, string> = {
  wikiBaseUrl: 'INTRANET_WIKI_BASE_URL',
  wikiToken: 'INTRANET_WIKI_TOKEN',
  gitlabBaseUrl: 'INTRANET_GITLAB_BASE_URL',
  gitlabToken: 'INTRANET_GITLAB_TOKEN',
}

/** The section fields naming each control's credential reference. */
export interface IntranetSettings {
  wikiBaseUrlEnv?: string
  wikiTokenEnv?: string
  gitlabBaseUrlEnv?: string
  gitlabTokenEnv?: string
}

/** What one credential control renders. */
export interface IntranetFieldState {
  /** Reference the control addresses. */
  ref: string
  /** Staged draft, blank on every load and after a successful save. */
  text: string
  /** Whether the Host reports any layer supplying a value. */
  configured: boolean
  /** Whether `credentials.set` can affect it; false disables the control. */
  writable: boolean
}

/** What the intranet card renders. */
export interface IntranetCardState {
  fields: Record<IntranetFieldName, IntranetFieldState>
  /** Whether any draft is staged. */
  dirty: boolean
  /** Whether a save is in flight. */
  saving: boolean
  /** Whether the last save left unwritten drafts. */
  saveFailed: boolean
}

/** The registration-side face the card's slot entry injects. */
export interface IntranetCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useIntranetCard. */
    intranetCard: SnapshotStore<IntranetCardState>
  }
  /**
   * Stage a draft for one control.
   * @param field - the control to stage.
   * @param text - the draft literal.
   */
  edit(field: IntranetFieldName, text: string): void
  /** Write every staged draft through the credentials domain. */
  save(): Promise<void>
  /** Drop every staged draft. */
  discard(): void
}

/** What the credentials domain last reported for one reference. */
interface CredentialView {
  configured: boolean
  writable: boolean
}

/** Bridges the `intranet` scope and the credentials domain onto the card. */
export class IntranetCardController {
  private readonly store: SnapshotStore<IntranetCardState>
  private staged: Record<IntranetFieldName, string> = { wikiBaseUrl: '', wikiToken: '', gitlabBaseUrl: '', gitlabToken: '' }
  private views = new Map<string, CredentialView>()
  private saving = false
  private saveFailed = false
  /** Increases whenever the addressed references change; stale answers are dropped. */
  private epoch = 0

  /**
   * @param scope - the bound settings scope for the `intranet` namespace.
   * @param api - wire face used for the credentials the section references.
   */
  constructor(
    private readonly scope: SettingsScope<IntranetSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { void this.readCredentials() })
    void this.readCredentials()
  }

  /** The reference each control addresses under the current section values. */
  private refs(): Record<IntranetFieldName, string> {
    const snapshot: SettingsScopeSnapshot<IntranetSettings> = this.scope.getSnapshot()
    const value = snapshot.value
    const declared: Record<IntranetFieldName, string | undefined> = {
      wikiBaseUrl: value?.wikiBaseUrlEnv,
      wikiToken: value?.wikiTokenEnv,
      gitlabBaseUrl: value?.gitlabBaseUrlEnv,
      gitlabToken: value?.gitlabTokenEnv,
    }
    const resolved = {} as Record<IntranetFieldName, string>
    for (const field of INTRANET_FIELDS) {
      const named = declared[field]
      resolved[field] = named !== undefined && named.length > 0 ? named : DEFAULT_REFS[field]
    }
    return resolved
  }

  private projection(): IntranetCardState {
    const refs = this.refs()
    const fields = {} as Record<IntranetFieldName, IntranetFieldState>
    for (const field of INTRANET_FIELDS) {
      const ref = refs[field]
      const view = this.views.get(ref)
      fields[field] = {
        ref,
        text: this.staged[field],
        configured: view?.configured ?? false,
        // An unknown reference is treated as writable: the control stays
        // usable and the Host is what refuses, not the card guessing.
        writable: view?.writable ?? true,
      }
    }
    return {
      fields,
      dirty: INTRANET_FIELDS.some(field => this.staged[field].length > 0),
      saving: this.saving,
      saveFailed: this.saveFailed,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  /**
   * Ask the credentials domain about the four references currently named.
   * Answers are fenced by epoch: the section can rename a reference between
   * the request and its response, and two reads can settle out of order.
   */
  private async readCredentials(): Promise<void> {
    const refs = this.refs()
    const requested = INTRANET_FIELDS.map(field => refs[field])
    const epoch = ++this.epoch
    this.publish()
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: requested })
    } catch (_credentialReadFailure) {
      // The card stays usable without this: controls report the last state
      // they knew, and a write still reaches the Host.
      return
    }
    if (!response.result.ok || epoch !== this.epoch) return
    for (const ref of requested) {
      const view = response.result.value.credentials[ref]
      this.views.set(ref, { configured: view?.configured ?? false, writable: view?.writable ?? true })
    }
    this.publish()
  }

  /**
   * Re-read after the Host reports a change to one watched reference. A value
   * can be written from another surface, and the section does not change when
   * it is, so without this the badge keeps a state the Host already replaced.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    const refs = this.refs()
    if (!INTRANET_FIELDS.some(field => refs[field] === ref)) return
    void this.readCredentials()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): IntranetCardFace {
    return {
      hooks: { intranetCard: this.store },
      edit: (field, text) => {
        this.staged[field] = text
        this.saveFailed = false
        this.publish()
      },
      save: async () => {
        if (this.saving) return
        this.saving = true
        this.publish()
        const refs = this.refs()
        let failed = false
        for (const field of INTRANET_FIELDS) {
          const value = this.staged[field]
          if (value.length === 0) continue
          try {
            await this.api.credentials.set({ ref: refs[field], value })
            this.staged[field] = ''
          } catch (_credentialWriteFailure) {
            // The draft stays staged; the Host's re-described state below is
            // the only authority on what was stored.
            failed = true
          }
        }
        this.saving = false
        this.saveFailed = failed
        await this.readCredentials()
        this.publish()
      },
      discard: () => {
        for (const field of INTRANET_FIELDS) this.staged[field] = ''
        this.saveFailed = false
        this.publish()
      },
    }
  }
}
