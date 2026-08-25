// @vitest-environment jsdom
/** Card rendering: four credential controls, their badges, and the actions. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IntranetCard } from '../src/client/IntranetCard.tsx'
import type { IntranetCardProps } from '../src/client/IntranetCard.tsx'
import type { IntranetCardState, IntranetFieldName } from '../src/client/intranet-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function fieldState(ref: string, overrides: Partial<IntranetCardState['fields'][IntranetFieldName]> = {}) {
  return { ref, text: '', configured: false, writable: true, ...overrides }
}

function stateOf(overrides: Partial<IntranetCardState> = {}): IntranetCardState {
  return {
    fields: {
      wikiBaseUrl: fieldState('INTRANET_WIKI_BASE_URL'),
      wikiToken: fieldState('INTRANET_WIKI_TOKEN', { configured: true }),
      gitlabBaseUrl: fieldState('INTRANET_GITLAB_BASE_URL'),
      gitlabToken: fieldState('INTRANET_GITLAB_TOKEN', { writable: false }),
    },
    dirty: false,
    saving: false,
    saveFailed: false,
    ...overrides,
  }
}

function renderCard(state: IntranetCardState, actions: Partial<Pick<IntranetCardProps, 'edit' | 'save' | 'discard'>> = {}) {
  const props = {
    t: (key: keyof typeof en) => en[key],
    useIntranetCard: (select: (snapshot: IntranetCardState) => IntranetCardState) => select(state),
    edit: vi.fn(),
    save: vi.fn(() => Promise.resolve()),
    discard: vi.fn(),
    ...actions,
  }
  render(<IntranetCard {...props as unknown as IntranetCardProps} />)
  return props
}

describe('IntranetCard', () => {
  it('renders the four controls with their references and configured badges', () => {
    renderCard(stateOf())
    expect(screen.getByLabelText(en.wikiBaseUrl)).toHaveProperty('value', '')
    expect(screen.getByText(`${en.wikiBaseUrlHint} (INTRANET_WIKI_BASE_URL)`)).toBeTruthy()
    expect(screen.getAllByText(en.configured)).toHaveLength(1)
    expect(screen.getAllByText(en.unconfigured)).toHaveLength(3)
    // An unwritable control is disabled; the rest stay editable.
    expect(screen.getByLabelText<HTMLInputElement>(en.gitlabToken).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(en.wikiToken).disabled).toBe(false)
  })

  it('stages keystrokes through edit without writing', () => {
    const props = renderCard(stateOf())
    fireEvent.change(screen.getByLabelText(en.wikiToken), { target: { value: 'secret' } })
    expect(props.edit).toHaveBeenCalledWith('wikiToken', 'secret')
    expect(props.save).not.toHaveBeenCalled()
  })

  it('enables the actions only while dirty and routes them to the face', () => {
    const clean = renderCard(stateOf())
    expect(screen.getByText<HTMLButtonElement>(en.save).disabled).toBe(true)
    cleanup()
    const dirty = renderCard(stateOf({
      dirty: true,
      fields: { ...stateOf().fields, wikiToken: fieldState('INTRANET_WIKI_TOKEN', { text: 'secret' }) },
    }))
    fireEvent.click(screen.getByText(en.save))
    fireEvent.click(screen.getByText(en.discard))
    expect(dirty.save).toHaveBeenCalled()
    expect(dirty.discard).toHaveBeenCalled()
    expect(clean.save).not.toHaveBeenCalled()
  })

  it('reports a failed save and shows the saving label while in flight', () => {
    renderCard(stateOf({ saveFailed: true }))
    expect(screen.getByText(en.saveFailed)).toBeTruthy()
    cleanup()
    renderCard(stateOf({ dirty: true, saving: true }))
    expect(screen.getByText<HTMLButtonElement>(en.saving).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(en.wikiToken).disabled).toBe(true)
  })
})
