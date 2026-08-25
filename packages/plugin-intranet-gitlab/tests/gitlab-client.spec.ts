// Client unit tests over an injected fetchFn: the network is the only mocked
// boundary; URL construction, paging, and payload validation are the shipping code.
import { describe, expect, it } from 'vitest'
import { GitlabHttpError, IntranetGitlabClient } from '../src/gitlab-client.ts'

const ENDPOINT = { baseUrl: 'http://git.example', token: 'tok' }

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status: 200, headers })
}

function clientWith(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): IntranetGitlabClient {
  return new IntranetGitlabClient(ENDPOINT, {
    fetchFn: (input, init) => Promise.resolve(handler(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      init,
    )),
  })
}

const PROJECT = { id: 42, name: 'Heads', path: 'heads-h5', path_with_namespace: 'ficc/heads-h5' }

describe('getProject', () => {
  it('fetches by encoded id or path with the private token', async () => {
    let seen: RequestInit | undefined
    const client = clientWith((url, init) => {
      expect(url).toBe('http://git.example/api/v4/projects/ficc%2Fheads-h5')
      seen = init
      return jsonResponse(PROJECT)
    })
    const project = await client.getProject('ficc/heads-h5')
    expect(project).toEqual(PROJECT)
    expect((seen?.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('tok')
    expect(client.baseUrl).toBe('http://git.example')
  })

  it('throws a status-carrying error on HTTP failure', async () => {
    const client = clientWith(() => new Response('gone', { status: 404 }))
    const failure = client.getProject('42')
    await expect(failure).rejects.toThrow('GitLab project 404: gone')
    await expect(client.getProject('42')).rejects.toBeInstanceOf(GitlabHttpError)
  })

  it('rejects non-JSON and non-project payloads', async () => {
    const garbled = clientWith(() => new Response('nope', { status: 200 }))
    await expect(garbled.getProject('42')).rejects.toThrow('invalid JSON')
    const wrong = clientWith(() => jsonResponse({ id: 'not-a-number' }))
    await expect(wrong.getProject('42')).rejects.toThrow('invalid project payload')
  })

  it('forwards the abort signal', async () => {
    const controller = new AbortController()
    let seenSignal: AbortSignal | null | undefined
    const client = clientWith((_url, init) => {
      seenSignal = init?.signal
      return jsonResponse(PROJECT)
    })
    await client.getProject('42', controller.signal)
    expect(seenSignal).toBe(controller.signal)
  })
})

describe('searchProjects', () => {
  it('follows X-Next-Page and stops cleanly when it ends', async () => {
    const pages: Record<string, unknown[]> = { 1: [PROJECT], 2: [{ ...PROJECT, id: 43 }] }
    const client = clientWith((url) => {
      const page = new URL(url).searchParams.get('page') ?? '1'
      return jsonResponse(pages[page] ?? [], page === '1' ? { 'X-Next-Page': '2' } : {})
    })
    const result = await client.searchProjects('heads')
    expect(result.projects.map(p => p.id)).toEqual([42, 43])
    expect(result.truncated).toBe(false)
  })

  it('reports truncation when paging stops at the budget', async () => {
    const client = clientWith((url) => {
      const page = Number(new URL(url).searchParams.get('page') ?? '1')
      return jsonResponse([{ ...PROJECT, id: page }], { 'X-Next-Page': String(page + 1) })
    })
    const result = await client.searchProjects('heads', { maxPages: 2 })
    expect(result.projects.map(p => p.id)).toEqual([1, 2])
    expect(result.truncated).toBe(true)
  })

  it('advances past a non-numeric next-page header', async () => {
    const calls: string[] = []
    const client = clientWith((url) => {
      const page = new URL(url).searchParams.get('page') ?? ''
      calls.push(page)
      return jsonResponse([], calls.length === 1 ? { 'X-Next-Page': 'weird' } : {})
    })
    await client.searchProjects('heads', { maxPages: 3 })
    expect(calls).toEqual(['1', '2'])
  })

  it('clamps the page size and rejects failures and bad payloads', async () => {
    let seen = ''
    const clamped = clientWith((url) => {
      seen = url
      return jsonResponse([])
    })
    await clamped.searchProjects('x', { perPage: 999 })
    expect(seen).toContain('per_page=100')
    const failing = clientWith(() => new Response('no', { status: 500 }))
    await expect(failing.searchProjects('x')).rejects.toThrow('GitLab project search 500')
    const garbled = clientWith(() => new Response('nope'))
    await expect(garbled.searchProjects('x')).rejects.toThrow('invalid JSON')
    const wrong = clientWith(() => jsonResponse([{ id: 'x' }]))
    await expect(wrong.searchProjects('x')).rejects.toThrow('invalid project list')
    const nonArray = clientWith(() => jsonResponse({}))
    await expect(nonArray.searchProjects('x')).rejects.toThrow('invalid project list')
    const nullEntry = clientWith(() => jsonResponse([null]))
    await expect(nullEntry.searchProjects('x')).rejects.toThrow('invalid project list')
  })
})

describe('raw files', () => {
  it('reads raw content at a ref and encodes the file path', async () => {
    const client = clientWith((url) => {
      expect(url).toBe('http://git.example/api/v4/projects/42/repository/files/src%2Fmain.ts/raw?ref=main')
      return new Response('export {}')
    })
    await expect(client.getRawFile({ projectId: '42', ref: 'main', filePath: 'src/main.ts' }))
      .resolves.toBe('export {}')
  })

  it('maps a 404 to null in getRawFileIfExists and rethrows the rest', async () => {
    const missing = clientWith(() => new Response('no', { status: 404 }))
    await expect(missing.getRawFileIfExists({ projectId: '42', ref: 'main', filePath: 'a.ts' }))
      .resolves.toBeNull()
    const denied = clientWith(() => new Response('no', { status: 403 }))
    await expect(denied.getRawFileIfExists({ projectId: '42', ref: 'main', filePath: 'a.ts' }))
      .rejects.toThrow('GitLab raw file 403')
  })
})

describe('searchBlobs', () => {
  it('filters matches to entries carrying a path and follows paging', async () => {
    const client = clientWith((url) => {
      const page = new URL(url).searchParams.get('page') ?? '1'
      return page === '1'
        ? jsonResponse([{ path: 'a.ts' }, { nope: true }], { 'X-Next-Page': '2' })
        : jsonResponse([{ path: 'b.ts' }])
    })
    const result = await client.searchBlobs({ projectId: '42', ref: 'main', search: 'x' })
    expect(result.matches.map(m => m.path)).toEqual(['a.ts', 'b.ts'])
    expect(result.truncated).toBe(false)
  })

  it('reports truncation at the page budget and rejects invalid payloads', async () => {
    const paged = clientWith(() => jsonResponse([{ path: 'a.ts' }], { 'X-Next-Page': '2' }))
    const result = await paged.searchBlobs({ projectId: '42', ref: 'main', search: 'x', maxPages: 1 })
    expect(result.truncated).toBe(true)
    const invalid = clientWith(() => jsonResponse({ not: 'an array' }))
    await expect(invalid.searchBlobs({ projectId: '42', ref: 'main', search: 'x' }))
      .rejects.toThrow('invalid payload')
    const failing = clientWith(() => new Response('no', { status: 500 }))
    await expect(failing.searchBlobs({ projectId: '42', ref: 'main', search: 'x' }))
      .rejects.toThrow('GitLab blob search 500')
  })

  it('falls back to incrementing the page on a non-numeric header', async () => {
    const calls: string[] = []
    const client = clientWith((url) => {
      calls.push(new URL(url).searchParams.get('page') ?? '')
      return jsonResponse([], calls.length === 1 ? { 'X-Next-Page': 'x' } : {})
    })
    await client.searchBlobs({ projectId: '42', ref: 'main', search: 'q', maxPages: 3 })
    expect(calls).toEqual(['1', '2'])
  })
})

describe('getRepositoryTree', () => {
  it('passes path, recursion, and page size through and parses entries', async () => {
    const client = clientWith((url) => {
      const parsed = new URL(url)
      expect(parsed.pathname).toBe('/api/v4/projects/42/repository/tree')
      expect(parsed.searchParams.get('path')).toBe('src')
      expect(parsed.searchParams.get('recursive')).toBe('true')
      expect(parsed.searchParams.get('per_page')).toBe('50')
      return jsonResponse([{ name: 'a.ts', path: 'src/a.ts', type: 'blob' }])
    })
    const tree = await client.getRepositoryTree({ projectId: '42', ref: 'main', path: 'src', recursive: true, perPage: 50 })
    expect(tree).toEqual([{ name: 'a.ts', path: 'src/a.ts', type: 'blob' }])
  })

  it('defaults the page size and surfaces failures', async () => {
    const client = clientWith((url) => {
      expect(new URL(url).searchParams.get('per_page')).toBe('100')
      return new Response('broken', { status: 502 })
    })
    await expect(client.getRepositoryTree({ projectId: '42', ref: 'main' }))
      .rejects.toThrow('GitLab repository tree 502: broken')
  })
})
