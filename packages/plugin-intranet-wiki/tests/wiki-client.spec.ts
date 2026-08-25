// Client unit tests over an injected fetchFn: the network is the only mocked
// boundary; parsing, budgets, and walk logic are the shipping code.
import { describe, expect, it } from 'vitest'
import { extractWikiPageId, IntranetWikiClient } from '../src/wiki-client.ts'

const ENDPOINT = { baseUrl: 'http://wiki.example', token: 'tok' }

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function clientWith(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): IntranetWikiClient {
  return new IntranetWikiClient(ENDPOINT, {
    fetchFn: (input, init) => Promise.resolve(handler(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init)),
  })
}

describe('extractWikiPageId', () => {
  it('extracts from a pageId query, a /pages/ path, and rejects the rest', () => {
    expect(extractWikiPageId('http://w/pages/viewpage.action?pageId=42')).toBe('42')
    expect(extractWikiPageId('http://w/spaces/X/pages/77/Title')).toBe('77')
    expect(extractWikiPageId('http://w/display/X')).toBeUndefined()
    expect(extractWikiPageId('   ')).toBeUndefined()
    expect(extractWikiPageId(undefined)).toBeUndefined()
  })
})

describe('readPage', () => {
  it('requires a page id or a URL carrying one', async () => {
    const client = clientWith(() => jsonResponse({}))
    await expect(client.readPage({})).rejects.toThrow('pageId or URL containing pageId is required')
  })

  it('parses the storage body, numeric id, version, space, and web link', async () => {
    const client = clientWith((url) => {
      expect(url).toBe('http://wiki.example/rest/api/content/12?expand=body.storage,body.view,version,_links,space')
      return jsonResponse({
        id: 12,
        title: 'T',
        version: { number: 3 },
        space: { key: 'SP' },
        body: { storage: { value: '<p>s</p>' } },
        _links: { webui: '/pages/12' },
      })
    })
    const page = await client.readPage({ pageId: '12' })
    expect(page).toEqual({
      pageId: '12',
      title: 'T',
      url: 'http://wiki.example/pages/12',
      version: 3,
      spaceKey: 'SP',
      html: '<p>s</p>',
    })
  })

  it('falls back to the view body, the input URL, and absent metadata', async () => {
    const client = clientWith(() => jsonResponse({
      body: { view: { value: '<p>v</p>' } },
      version: { number: 'not-a-number' },
    }))
    const page = await client.readPage({ url: 'http://wiki.example/pages/9' })
    expect(page).toEqual({
      pageId: '9',
      title: '',
      url: 'http://wiki.example/pages/9',
      version: undefined,
      spaceKey: undefined,
      html: '<p>v</p>',
    })
  })

  it('serves an empty body and no URL when the API omits both', async () => {
    const client = clientWith(() => jsonResponse({ id: '5' }))
    const page = await client.readPage({ pageId: '5' })
    expect(page.html).toBe('')
    expect(page.url).toBe('')
  })

  it('throws with the status and body excerpt on an HTTP failure', async () => {
    const client = clientWith(() => new Response('denied because of reasons', { status: 403 }))
    await expect(client.readPage({ pageId: '1' })).rejects.toThrow('Wiki API 403: denied because of reasons')
  })

  it('names the request when the API returns non-JSON', async () => {
    const client = clientWith(() => new Response('<html>login</html>', { status: 200 }))
    await expect(client.readPage({ pageId: '1' })).rejects.toThrow('non-JSON response (pageId=1)')
  })

  it('sends the bearer token and forwards the abort signal', async () => {
    const controller = new AbortController()
    let seenAuth: string | undefined
    let seenSignal: AbortSignal | null | undefined
    const client = clientWith((_url, init) => {
      seenAuth = (init?.headers as Record<string, string>).Authorization
      seenSignal = init?.signal
      return jsonResponse({ id: '1' })
    })
    await client.readPage({ pageId: '1', signal: controller.signal })
    expect(seenAuth).toBe('Bearer tok')
    expect(seenSignal).toBe(controller.signal)
  })
})

describe('listChildPages', () => {
  it('maps entries, drops id-less rows, and defaults paging', async () => {
    const client = clientWith((url) => {
      expect(url).toBe('http://wiki.example/rest/api/content/7/child/page?start=0&limit=100&expand=version,_links')
      return jsonResponse({
        results: [
          { id: '8', title: 'A', version: { number: 2 }, _links: { webui: '/pages/8' } },
          { title: 'no id' },
        ],
        _links: {},
      })
    })
    const { pages, nextStart } = await client.listChildPages({ pageId: '7' })
    expect(pages).toEqual([{
      pageId: '8',
      parentPageId: '7',
      depth: 1,
      title: 'A',
      url: 'http://wiki.example/pages/8',
      version: 2,
    }])
    expect(nextStart).toBeUndefined()
  })

  it('reads the next paging offset from _links.next', async () => {
    const client = clientWith(() => jsonResponse({
      results: [],
      _links: { next: '/rest/api/content/7/child/page?start=25' },
    }))
    const { nextStart } = await client.listChildPages({ pageId: '7' })
    expect(nextStart).toBe(25)
  })

  it('ignores a next link that does not advance the offset', async () => {
    const client = clientWith(() => jsonResponse({
      results: [],
      _links: { next: '/rest/api/content/7/child/page?start=0' },
    }))
    const { nextStart } = await client.listChildPages({ pageId: '7', start: 0 })
    expect(nextStart).toBeUndefined()
  })

  it('infers a next offset from a full window without a next link', async () => {
    const client = clientWith(() => jsonResponse({
      results: [{ id: '1', title: 'x' }, { id: '2', title: 'y' }],
      _links: {},
    }))
    const { nextStart } = await client.listChildPages({ pageId: '7', limit: 2 })
    expect(nextStart).toBe(2)
  })

  it('clamps the paging window and floors the offset', async () => {
    let seen = ''
    const client = clientWith((url) => {
      seen = url
      return jsonResponse({ results: [] })
    })
    await client.listChildPages({ pageId: '7', start: -5, limit: 999 })
    expect(seen).toContain('start=0&limit=200')
  })

  it('treats a non-array results field as empty', async () => {
    const client = clientWith(() => jsonResponse({ results: 'nope' }))
    const { pages } = await client.listChildPages({ pageId: '7' })
    expect(pages).toEqual([])
  })

  it('serves an empty title and URL for a bare child row', async () => {
    const client = clientWith(() => jsonResponse({ results: [{ id: 3 }] }))
    const { pages } = await client.listChildPages({ pageId: '7' })
    expect(pages).toEqual([{ pageId: '3', parentPageId: '7', depth: 1, title: '', url: '', version: undefined }])
  })

  it('throws on HTTP failure and non-JSON bodies', async () => {
    const failing = clientWith(() => new Response('gone', { status: 410 }))
    await expect(failing.listChildPages({ pageId: '7' })).rejects.toThrow('Wiki API 410')
    const garbled = clientWith(() => new Response('not json'))
    await expect(garbled.listChildPages({ pageId: '7' })).rejects.toThrow('non-JSON response (parentPageId=7)')
  })
})

describe('listDescendantPages', () => {
  function treeClient(children: Record<string, { id: string; title: string }[]>): IntranetWikiClient {
    return clientWith((url) => {
      const match = url.match(/content\/([^/]+)\/child\/page\?start=(\d+)&limit=(\d+)/)
      if (match === null) throw new Error(`unexpected url ${url}`)
      const limit = Number(match[3])
      const start = Number(match[2])
      const all = children[match[1] ?? ''] ?? []
      return jsonResponse({ results: all.slice(start, start + limit), _links: {} })
    })
  }

  it('walks breadth-first, dedupes revisited ids, and completes cleanly', async () => {
    const client = treeClient({
      root: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      a: [{ id: 'b', title: 'B' }],
      b: [],
    })
    const tree = await client.listDescendantPages({ rootPageId: 'root', maxDepth: 5, maxPages: 10 })
    expect(tree.truncated).toBe(false)
    expect(tree.warnings).toEqual([])
    expect(tree.pages.map(page => page.pageId)).toEqual(['a', 'b'])
  })

  it('flags truncation when children exist beyond the depth budget', async () => {
    const client = treeClient({
      root: [{ id: 'a', title: 'A' }],
      a: [{ id: 'deep', title: 'Deep' }],
    })
    const tree = await client.listDescendantPages({ rootPageId: 'root', maxDepth: 1, maxPages: 10 })
    expect(tree.pages.map(page => page.pageId)).toEqual(['a'])
    expect(tree.truncated).toBe(true)
    expect(tree.warnings[0]).toContain('maxDepth=1')
  })

  it('flags truncation when the page budget fills before the frontier', async () => {
    const client = treeClient({
      root: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }],
      a: [],
      b: [],
      c: [],
    })
    const tree = await client.listDescendantPages({ rootPageId: 'root', maxDepth: 5, maxPages: 2 })
    expect(tree.pages.map(page => page.pageId)).toEqual(['a', 'b'])
    expect(tree.truncated).toBe(true)
  })

  it('pages through a large child window before descending', async () => {
    const many = Array.from({ length: 150 }, (_, index) => ({ id: `c${index}`, title: `C${index}` }))
    const client = treeClient({ root: many })
    const tree = await client.listDescendantPages({ rootPageId: 'root', maxDepth: 2, maxPages: 200 })
    expect(tree.pages).toHaveLength(150)
    expect(tree.truncated).toBe(false)
  })

  it('records a failed child listing as truncation and keeps walking', async () => {
    const client = clientWith((url) => {
      if (url.includes('content/bad/')) return new Response('boom', { status: 500 })
      const match = url.match(/content\/([^/]+)\/child/)
      const children = match?.[1] === 'root' ? [{ id: 'bad', title: 'Bad' }, { id: 'ok', title: 'Ok' }] : []
      return jsonResponse({ results: children, _links: {} })
    })
    const tree = await client.listDescendantPages({ rootPageId: 'root', maxDepth: 3, maxPages: 10 })
    expect(tree.pages.map(page => page.pageId)).toEqual(['bad', 'ok'])
    expect(tree.truncated).toBe(true)
    expect(tree.warnings[0]).toContain('Failed to list children of page bad')
  })

  it('stringifies a non-Error listing failure into the warning', async () => {
    const client = clientWith((url) => {
      if (url.includes('content/root/')) {
        // A foreign fetch implementation may reject with a bare value.
        // oxlint-disable-next-line no-throw-literal
        throw 'socket exploded'
      }
      return jsonResponse({ results: [], _links: {} })
    })
    const tree = await client.listDescendantPages({ rootPageId: 'root', maxDepth: 2, maxPages: 5 })
    expect(tree.truncated).toBe(true)
    expect(tree.warnings[0]).toContain('socket exploded')
  })

  it('rethrows a listing failure caused by cancellation', async () => {
    const controller = new AbortController()
    const client = clientWith(() => {
      controller.abort()
      throw new Error('aborted by caller')
    })
    await expect(
      client.listDescendantPages({ rootPageId: 'root', maxDepth: 2, maxPages: 5, signal: controller.signal }),
    ).rejects.toThrow('aborted by caller')
  })
})

describe('createChildPage and updatePage', () => {
  it('creates under the parent space and parses the write response', async () => {
    const bodies: unknown[] = []
    const client = clientWith((url, init) => {
      if (url.includes('/rest/api/content/9?')) {
        return jsonResponse({ id: '9', title: 'P', space: { key: 'SP' }, body: {}, _links: { webui: '/pages/9' } })
      }
      expect(url).toBe('http://wiki.example/rest/api/content')
      expect(init?.method).toBe('POST')
      bodies.push(JSON.parse(init?.body as string))
      return jsonResponse({ id: 20, title: 'Child', version: { number: 1 }, _links: { webui: '/pages/20' } })
    })
    const created = await client.createChildPage({ parentPageId: '9', title: 'Child', storage: '<p>c</p>' })
    expect(created.pageId).toBe('20')
    expect(created.url).toBe('http://wiki.example/pages/20')
    expect(bodies[0]).toMatchObject({
      type: 'page',
      title: 'Child',
      space: { key: 'SP' },
      ancestors: [{ id: '9' }],
      body: { storage: { value: '<p>c</p>', representation: 'storage' } },
    })
  })

  it('refuses to create under a parent with no space key', async () => {
    const client = clientWith(() => jsonResponse({ id: '9', title: 'P', body: {} }))
    await expect(client.createChildPage({ parentPageId: '9', title: 'C', storage: '' }))
      .rejects.toThrow('did not include a space key')
  })

  it('updates at the explicit version and keeps the fallback URL on writes', async () => {
    const client = clientWith((url, init) => {
      expect(url).toBe('http://wiki.example/rest/api/content/9')
      expect(init?.method).toBe('PUT')
      const body = JSON.parse(init?.body as string) as { version: { number: number } }
      expect(body.version.number).toBe(4)
      return jsonResponse({ id: '9', title: 'P', version: { number: 4 }, body: {} })
    })
    const updated = await client.updatePage({ pageId: '9', title: 'P', version: 4, storage: '<p>u</p>' })
    expect(updated.version).toBe(4)
    expect(updated.url).toBe('')
  })

  it('propagates write failures with the response excerpt', async () => {
    const client = clientWith((_url, init) => (init?.method === 'PUT'
      ? new Response('conflict', { status: 409 })
      : jsonResponse({ id: '9', space: { key: 'SP' }, body: {} })))
    await expect(client.updatePage({ pageId: '9', title: 'P', version: 2, storage: '' }))
      .rejects.toThrow('Wiki API 409: conflict')
    const nonJson = clientWith(() => new Response('weird'))
    await expect(nonJson.updatePage({ pageId: '9', title: 'P', version: 2, storage: '' }))
      .rejects.toThrow('non-JSON response (write)')
  })
})
