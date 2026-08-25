/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list whose plugins the manifest
 * declares as dependencies.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('dsh-intranet bundle', () => {
  it('declares a parseable patch list whose rows are manifest dependencies', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('intranet patch must parse to a patch list')
    const rows = parsed.flatMap((patch): { id?: string; name?: string; config?: Record<string, unknown> }[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: { id?: string; name?: string; config?: Record<string, unknown> }[] }).insert ?? []
        : [],
    )
    expect(rows.map(row => row.id)).toEqual(['intranet-tool-wiki', 'intranet-tool-gitlab'])
    // The write policy is this bundle's one explicit choice; the credential
    // references stay on the packages' defaults.
    expect(rows[0]?.config).toEqual({ applyWriteApproval: 'ask' })
    for (const row of rows) {
      expect(manifest.dependencies).toHaveProperty(row.name ?? '')
    }
  })
})
