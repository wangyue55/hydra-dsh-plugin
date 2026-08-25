import { describe, expect, it } from 'vitest'
import { CodeScopeDiscoverer } from '../src/code-scope-discoverer.ts'
import type { IntranetGitlabClient } from '../src/gitlab-client.ts'
import type { GitlabBlobSearchResult } from '../src/types.ts'

const BUDGETS = {
  maxQueries: 6,
  searchPerPage: 20,
  searchMaxPages: 2,
  maxCandidateFiles: 24,
  maxDiscoveredPaths: 30,
}

interface FakeRepo {
  files?: Record<string, string>
  blobs?: Record<string, string[]>
  blobError?: string
}

/** Fake of the two client operations the discoverer uses. */
function fakeClient(repo: FakeRepo): IntranetGitlabClient {
  const fake = {
    getRawFileIfExists: (input: { filePath: string }) =>
      Promise.resolve(repo.files?.[input.filePath] ?? null),
    searchBlobs: (input: { search: string }): Promise<GitlabBlobSearchResult> => {
      if (repo.blobError !== undefined) return Promise.reject(new Error(repo.blobError))
      return Promise.resolve({
        matches: (repo.blobs?.[input.search] ?? []).map(path => ({ path })),
        truncated: false,
      })
    },
  }
  return fake as unknown as IntranetGitlabClient
}

const GUIDE = 'docs/agent/模块代码定位指南.md'
const ROUTED = "path: '/heads'\nimport('./views/HeadsPage.vue')\nimport('lodash')\nimport('./style.css')\nheads keyword"

function discover(repo: FakeRepo, input: Record<string, unknown> = {}) {
  return new CodeScopeDiscoverer(fakeClient(repo), BUDGETS).discover({
    projectId: '42',
    ref: 'main',
    ...input,
  })
}

describe('guidance probing', () => {
  it('collects CLAUDE.md, its referenced guides, and the module guide it names', async () => {
    const result = await discover({
      files: {
        'CLAUDE.md': `see [guide](${GUIDE}) and [arch](guides/arch.md) plus [gone](guides/gone.md)`,
        [GUIDE]: 'guide body',
        'guides/arch.md': 'arch body',
      },
      blobs: {},
    }, { moduleHints: ['heads'] })
    expect(result.guidanceFiles).toEqual(['CLAUDE.md', GUIDE, 'guides/arch.md'])
  })

  it('warns when the module guide exists but CLAUDE.md ignores it', async () => {
    const result = await discover({
      files: { 'CLAUDE.md': 'no links here', [GUIDE]: 'guide body' },
    }, { moduleHints: ['heads'] })
    expect(result.guidanceFiles).toEqual(['CLAUDE.md'])
    expect(result.warnings[0]).toContain('does not reference it')
  })

  it('skips external, absolute, and parent-escaping markdown references', async () => {
    const result = await discover({
      files: {
        'CLAUDE.md': '[x](https://e.example/a.md) [y](/abs.md) [z](../up.md) [ok](guides/ok.md)',
        'guides/ok.md': 'ok',
      },
    }, { moduleHints: ['heads'] })
    expect(result.guidanceFiles).toEqual(['CLAUDE.md', 'guides/ok.md'])
  })
})

describe('scope discovery', () => {
  it('confirms files with hint plus route/import evidence and pulls their imports', async () => {
    const result = await discover({
      files: { 'src/router.ts': ROUTED },
      blobs: { heads: ['src/router.ts'] },
    }, { moduleHints: ['heads'] })
    expect(result.status).toBe('confirmed')
    expect(result.effectivePaths).toEqual(['src/router.ts', 'src/views/HeadsPage.vue'])
    expect(result.evidence[0]).toContain('route/module registration')
  })

  it('keeps hint-only matches as candidates without supplementing the scope', async () => {
    const result = await discover({
      files: { 'src/util.ts': 'heads helper without registration' },
      blobs: { heads: ['src/util.ts'] },
    }, { moduleHints: ['heads'], userPaths: ['src/pages'] })
    expect(result.status).toBe('candidate')
    expect(result.effectivePaths).toEqual(['src/pages'])
    expect(result.comparison.userOnly).toEqual(['src/pages'])
    expect(result.evidence[0]).toContain('incomplete')
  })

  it('is unresolved with no matches and records search failures as warnings', async () => {
    const result = await discover({ blobError: 'search exploded' }, { moduleHints: ['heads'] })
    expect(result.status).toBe('unresolved')
    expect(result.warnings.some(w => w.includes('Code search failed: search exploded'))).toBe(true)
  })

  it('compares user paths against discoveries and supplements only confirmed ones', async () => {
    const result = await discover({
      files: { 'src/router.ts': ROUTED, 'src/loose.ts': 'heads but loose' },
      blobs: { heads: ['src/router.ts', 'src/loose.ts'] },
    }, { moduleHints: ['heads'], userPaths: ['src/router.ts'] })
    expect(result.comparison.overlap).toEqual(['src/router.ts'])
    expect(result.comparison.autoSupplement).toContain('src/loose.ts')
    expect(result.effectivePaths).toContain('src/views/HeadsPage.vue')
    expect(result.effectivePaths).not.toContain('src/loose.ts')
  })

  it('dedupes, floors, and caps the hint queries', async () => {
    const searched: string[] = []
    const client = {
      getRawFileIfExists: () => Promise.resolve(null),
      searchBlobs: (input: { search: string }) => {
        searched.push(input.search)
        return Promise.resolve({ matches: [], truncated: false })
      },
    } as unknown as IntranetGitlabClient
    await new CodeScopeDiscoverer(client, { ...BUDGETS, maxQueries: 3 }).discover({
      projectId: '42',
      ref: 'main',
      moduleHints: ['heads', 'heads', 'a'],
      routeHints: ['/pay'],
      apiHints: ['api/x'],
      uiTexts: ['确认下单'],
      changeDescription: 'change the payment flow',
    })
    expect(searched).toEqual(['heads', '/pay', 'api/x'])
  })

  it('ignores an empty change description and hint-less candidate files', async () => {
    const result = await discover({
      files: { 'src/none.ts': 'nothing relevant here' },
      blobs: { heads: ['src/none.ts'] },
    }, { moduleHints: ['heads'], changeDescription: '' })
    expect(result.status).toBe('unresolved')
    expect(result.evidence).toEqual([])
  })

  it('searches from non-module clue kinds alone', async () => {
    const result = await discover({ blobs: { '/pay': [] } }, { routeHints: ['/pay'] })
    expect(result.status).toBe('unresolved')
  })

  it('treats a rejected guidance probe as an absent file', async () => {
    const client = {
      getRawFileIfExists: (input: { filePath: string }) => (input.filePath === 'CLAUDE.md'
        ? Promise.reject(new Error('probe exploded'))
        : Promise.resolve(null)),
      searchBlobs: () => Promise.resolve({ matches: [], truncated: false }),
    } as unknown as IntranetGitlabClient
    const result = await new CodeScopeDiscoverer(client, BUDGETS).discover({
      projectId: '42',
      ref: 'main',
      moduleHints: ['heads'],
    })
    expect(result.guidanceFiles).toEqual([])
  })

  it('ranks router files before views before the rest, breaking ties by name', async () => {
    const probed: string[] = []
    const client = {
      getRawFileIfExists: (input: { filePath: string }) => {
        if (input.filePath !== 'CLAUDE.md' && input.filePath !== GUIDE) probed.push(input.filePath)
        return Promise.resolve(null)
      },
      searchBlobs: () => Promise.resolve({
        matches: [{ path: 'notes.pro' }, { path: 'b/view.vue' }, { path: 'a/view.vue' }, { path: 'src/router.ts' }],
        truncated: false,
      }),
    } as unknown as IntranetGitlabClient
    await new CodeScopeDiscoverer(client, BUDGETS).discover({ projectId: '42', ref: 'main', moduleHints: ['heads'] })
    expect(probed).toEqual(['src/router.ts', 'a/view.vue', 'b/view.vue', 'notes.pro'])
  })

  it('stringifies a non-Error search failure into the warning', async () => {
    const client = {
      getRawFileIfExists: () => Promise.resolve(null),
      searchBlobs: () => {
        // A foreign fetch implementation may reject with a bare value.
        // oxlint-disable-next-line prefer-promise-reject-errors
        return Promise.reject('socket exploded')
      },
    } as unknown as IntranetGitlabClient
    const result = await new CodeScopeDiscoverer(client, BUDGETS).discover({
      projectId: '42',
      ref: 'main',
      moduleHints: ['heads'],
    })
    expect(result.warnings[0]).toContain('socket exploded')
  })

  it('propagates blob-search truncation', async () => {
    const client = {
      getRawFileIfExists: () => Promise.resolve(null),
      searchBlobs: () => Promise.resolve({ matches: [{ path: 'a.ts' }], truncated: true }),
    } as unknown as IntranetGitlabClient
    const result = await new CodeScopeDiscoverer(client, BUDGETS).discover({
      projectId: '42',
      ref: 'main',
      moduleHints: ['heads'],
    })
    expect(result.truncated).toBe(true)
  })

  it('stops after the settled probes when the caller cancelled', async () => {
    const controller = new AbortController()
    const client = {
      getRawFileIfExists: () => {
        controller.abort()
        return Promise.resolve(null)
      },
      searchBlobs: () => Promise.resolve({ matches: [], truncated: false }),
    } as unknown as IntranetGitlabClient
    await expect(new CodeScopeDiscoverer(client, BUDGETS).discover({
      projectId: '42',
      ref: 'main',
      moduleHints: ['heads'],
      signal: controller.signal,
    })).rejects.toThrow('cancelled')
  })
})
