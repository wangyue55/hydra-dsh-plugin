/**
 * The intranet credentials card: four secret controls addressed by the
 * references the `intranet` section names, written through the credentials
 * domain. The card owns its own chrome — the section's shared card
 * components are another plugin's values, which the bundle-purity gate keeps
 * un-importable.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './IntranetCard.module.css'
import type { IntranetCardFace, IntranetCardState, IntranetFieldName } from './intranet-card-controller.ts'
import type { IntranetSettingsLocaleKey } from './locales.ts'

/** The copy pair each control renders. */
const FIELD_COPY: Record<IntranetFieldName, { label: IntranetSettingsLocaleKey; hint: IntranetSettingsLocaleKey }> = {
  wikiBaseUrl: { label: 'wikiBaseUrl', hint: 'wikiBaseUrlHint' },
  wikiToken: { label: 'wikiToken', hint: 'wikiTokenHint' },
  gitlabBaseUrl: { label: 'gitlabBaseUrl', hint: 'gitlabBaseUrlHint' },
  gitlabToken: { label: 'gitlabToken', hint: 'gitlabTokenHint' },
}

/** Props the renderer binds for the intranet card. */
export type IntranetCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.intranet'>
  & InjectFace<IntranetCardFace>

/**
 * Render the intranet credentials card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function IntranetCard(props: IntranetCardProps) {
  const { t } = props
  const state: IntranetCardState = props.useIntranetCard(snapshot => snapshot)
  return (
    <section className={css.card} aria-label={t('title')}>
      <div className={css.title}>{t('title')}</div>
      <div className={css.description}>{t('description')}</div>
      {(Object.keys(FIELD_COPY) as IntranetFieldName[]).map((field) => {
        const view = state.fields[field]
        const copy = FIELD_COPY[field]
        const id = `plugin-config-intranet-${field}`
        return (
          <div className={css.field} key={field}>
            <div className={css.head}>
              <label className={css.label} htmlFor={id}>{t(copy.label)}</label>
              <span className={view.configured ? `${css.badge} ${css.badgeOn}` : css.badge}>
                {view.configured ? t('configured') : t('unconfigured')}
              </span>
            </div>
            <input
              id={id}
              className={css.input}
              type="password"
              autoComplete="off"
              placeholder={t('placeholder')}
              value={view.text}
              disabled={!view.writable || state.saving}
              onChange={(event) => { props.edit(field, event.currentTarget.value) }}
            />
            <div className={css.hint}>{`${t(copy.hint)} (${view.ref})`}</div>
          </div>
        )
      })}
      {state.saveFailed ? <div className={css.error}>{t('saveFailed')}</div> : null}
      <div className={css.actions}>
        <button
          type="button"
          className={css.button}
          disabled={!state.dirty || state.saving}
          onClick={() => { props.discard() }}
        >
          {t('discard')}
        </button>
        <button
          type="button"
          className={`${css.button} ${css.primary}`}
          disabled={!state.dirty || state.saving}
          onClick={() => { void props.save() }}
        >
          {state.saving ? t('saving') : t('save')}
        </button>
      </div>
    </section>
  )
}
