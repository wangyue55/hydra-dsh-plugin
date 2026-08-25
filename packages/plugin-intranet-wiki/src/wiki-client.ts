/**
 * Confluence-style REST client for the intranet wiki. Ported from the
 * hydra-agent internal wiki client; every request honors the caller's
 * `AbortSignal` and the injectable `fetchFn` is the test seam for the network
 * boundary.
 * @module @hydra-dsh/plugin-intranet-wiki/src/wiki-client
 */

import type { WikiEndpoint, WikiPage, WikiPageSummary, WikiPageTree } from './types.ts'

/** Constructor options for {@link IntranetWikiClient}. */
export interface IntranetWikiClientOptions {
  /** Fetch implementation; defaults to the global `fetch`. */
  fetchFn?: typeof fetch | undefined
}

/** Child-page listing request for one paging step. */
export interface ListChildPagesInput {
  /** Parent page id whose direct children are listed. */
  pageId: string
  /** Zero-based paging offset. */
  start?: number | undefined
  /** Page size, clamped to [1, 200]. */
  limit?: number | undefined
  /** Depth recorded on the returned summaries; direct children are 1. */
  depth?: number | undefined
  /** Cancels the request when aborted. */
  signal?: AbortSignal | undefined
}

/** Descendant-walk request with its caller-resolved budgets. */
export interface ListDescendantPagesInput {
  /** Page id the breadth-first walk starts from. */
  rootPageId: string
  /** Maximum depth below the root to descend into; at least 1. */
  maxDepth: number
  /** Maximum descendant pages to collect; at least 1. */
  maxPages: number
  /** Cancels the walk when aborted. */
  signal?: AbortSignal | undefined
}

/**
 * Extract a wiki page id from a page URL carrying `pageId=<digits>` or a
 * `/pages/<digits>` path segment.
 * @param url - candidate page URL.
 * @returns the page id, or `undefined` when the URL carries none.
 */
export function extractWikiPageId(url?: string): string | undefined {
  const value = (url ?? '').trim()
  if (!value) return undefined
  const match = value.match(/[?&]pageId=(\d+)/) ?? value.match(/\/pages\/(\d+)/)
  return match?.[1]
}

/**
 * Minimal Confluence REST client over `fetch`. Methods throw `Error` for HTTP
 * failures and non-JSON bodies; they never retry.
 */
export class IntranetWikiClient {
  private readonly fetchFn: typeof fetch

  constructor(
    private readonly endpoint: WikiEndpoint,
    options: IntranetWikiClientOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch
  }

  /**
   * Read one page with its storage body, version, space, and web link.
   * @param input - page id, or a URL carrying one; `signal` cancels the request.
   * @returns the page.
   */
  async readPage(input: { pageId?: string | undefined; url?: string | undefined; signal?: AbortSignal | undefined }): Promise<WikiPage> {
    const pageId = input.pageId ?? extractWikiPageId(input.url)
    if (!pageId) {
      throw new Error('A wiki pageId or URL containing pageId is required')
    }

    const apiUrl = `${this.endpoint.baseUrl}/rest/api/content/${encodeURIComponent(
      pageId,
    )}?expand=body.storage,body.view,version,_links,space`

    const response = await this.fetchFn(apiUrl, {
      headers: this.buildHeaders(),
      signal: input.signal ?? null,
    })

    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Wiki API ${response.status}: ${text.slice(0, 300)}`)
    }

    const json = parseJsonRecord(text, `pageId=${pageId}`)
    const html = stringOrUndefined(record(record(json.body).storage).value)
      ?? stringOrUndefined(record(record(json.body).view).value)
      ?? ''
    const webui = stringOrUndefined(record(json._links).webui)
    const url = input.url ?? (webui !== undefined && webui.length > 0 ? `${this.endpoint.baseUrl}${webui}` : '')

    return {
      pageId: idText(json.id) ?? pageId,
      title: stringOrUndefined(json.title) ?? '',
      url,
      version: numberOrUndefined(record(json.version).number),
      spaceKey: stringOrUndefined(record(json.space).key),
      html,
    }
  }

  /**
   * List one paging window of a page's direct children.
   * @param input - parent id, paging window, and recorded depth.
   * @returns the window plus the next paging offset when more children remain.
   */
  async listChildPages(input: ListChildPagesInput): Promise<{ pages: WikiPageSummary[]; nextStart?: number | undefined }> {
    const start = Math.max(0, input.start ?? 0)
    const limit = Math.min(Math.max(1, input.limit ?? 100), 200)
    const apiUrl = `${this.endpoint.baseUrl}/rest/api/content/${encodeURIComponent(
      input.pageId,
    )}/child/page?start=${start}&limit=${limit}&expand=version,_links`
    const response = await this.fetchFn(apiUrl, { headers: this.buildHeaders(), signal: input.signal ?? null })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Wiki API ${response.status}: ${text.slice(0, 300)}`)
    }

    const json = parseJsonRecord(text, `parentPageId=${input.pageId}`)
    const results = Array.isArray(json.results) ? json.results : []
    const pages = results.map((item): WikiPageSummary => {
      const entry = record(item)
      const webui = stringOrUndefined(record(entry._links).webui)
      return {
        pageId: idText(entry.id) ?? '',
        parentPageId: input.pageId,
        depth: input.depth ?? 1,
        title: stringOrUndefined(entry.title) ?? '',
        url: webui !== undefined && webui.length > 0 ? `${this.endpoint.baseUrl}${webui}` : '',
        version: numberOrUndefined(record(entry.version).number),
      }
    }).filter(page => page.pageId.length > 0)

    const nextLink = stringOrUndefined(record(json._links).next)
    let nextStart: number | undefined
    if (nextLink !== undefined) {
      const parsed = new URL(nextLink, this.endpoint.baseUrl)
      const value = Number(parsed.searchParams.get('start'))
      if (Number.isInteger(value) && value > start) nextStart = value
    } else if (results.length === limit) {
      nextStart = start + results.length
    }

    return { pages, nextStart }
  }

  /**
   * Walk a page's descendants breadth-first within the supplied budgets. Child
   * listings that fail mark the tree truncated instead of failing the walk.
   * @param input - root page and caller-resolved depth/page budgets.
   * @returns discovered summaries plus truncation state and diagnostics.
   */
  async listDescendantPages(input: ListDescendantPagesInput): Promise<WikiPageTree> {
    const maxDepth = Math.max(1, input.maxDepth)
    const maxPages = Math.max(1, input.maxPages)
    const pages: WikiPageSummary[] = []
    const warnings: string[] = []
    const visited = new Set<string>([input.rootPageId])
    const queue: { pageId: string; depth: number }[] = [
      { pageId: input.rootPageId, depth: 0 },
    ]
    let truncated = false

    for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
      let start = 0

      do {
        let batch: { pages: WikiPageSummary[]; nextStart?: number | undefined }
        // At a budget boundary one probe child is still fetched so the walk can
        // distinguish "no children" from "children beyond the budget".
        const atBoundary = current.depth >= maxDepth || pages.length >= maxPages
        try {
          batch = await this.listChildPages({
            pageId: current.pageId,
            start,
            limit: atBoundary ? 1 : 100,
            depth: current.depth + 1,
            signal: input.signal,
          })
        } catch (err) {
          if (input.signal?.aborted) throw err
          truncated = true
          warnings.push(
            `Failed to list children of page ${current.pageId}: ${err instanceof Error ? err.message : String(err)}`,
          )
          break
        }

        for (const page of batch.pages) {
          if (visited.has(page.pageId)) continue
          visited.add(page.pageId)

          if (current.depth >= maxDepth) {
            truncated = true
            continue
          }
          if (pages.length >= maxPages) {
            truncated = true
            continue
          }

          pages.push(page)
          queue.push({ pageId: page.pageId, depth: page.depth })
        }

        if (atBoundary && batch.pages.length > 0) break
        if (batch.nextStart === undefined) break
        start = batch.nextStart
      } while (true)
    }

    if (truncated) {
      warnings.push(`The descendant tree exceeds maxDepth=${maxDepth} or maxPages=${maxPages}; the result is incomplete`)
    }
    return { pages, truncated, warnings }
  }

  /**
   * Create a child page under a parent, inheriting the parent's space.
   * @param input - parent id, new title, and storage-format body.
   * @returns the created page.
   */
  async createChildPage(input: {
    parentPageId: string
    title: string
    storage: string
    signal?: AbortSignal | undefined
  }): Promise<WikiPage> {
    const parent = await this.readPage({ pageId: input.parentPageId, signal: input.signal })
    if (parent.spaceKey === undefined) {
      throw new Error(`Wiki parent page ${input.parentPageId} did not include a space key`)
    }

    const response = await this.fetchFn(`${this.endpoint.baseUrl}/rest/api/content`, {
      method: 'POST',
      headers: this.buildHeaders(),
      signal: input.signal ?? null,
      body: JSON.stringify({
        type: 'page',
        title: input.title,
        space: { key: parent.spaceKey },
        ancestors: [{ id: parent.pageId }],
        body: {
          storage: {
            value: input.storage,
            representation: 'storage',
          },
        },
      }),
    })

    return this.parseWriteResponse(response, parent.url)
  }

  /**
   * Replace a page's storage body at an explicit next version number.
   * @param input - page id, retained title, next version, and new body.
   * @returns the updated page.
   */
  async updatePage(input: {
    pageId: string
    title: string
    version: number
    storage: string
    signal?: AbortSignal | undefined
  }): Promise<WikiPage> {
    const response = await this.fetchFn(
      `${this.endpoint.baseUrl}/rest/api/content/${encodeURIComponent(input.pageId)}`,
      {
        method: 'PUT',
        headers: this.buildHeaders(),
        signal: input.signal ?? null,
        body: JSON.stringify({
          id: input.pageId,
          type: 'page',
          title: input.title,
          version: { number: input.version },
          body: {
            storage: {
              value: input.storage,
              representation: 'storage',
            },
          },
        }),
      },
    )

    return this.parseWriteResponse(response)
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.endpoint.token}`,
    }
  }

  private async parseWriteResponse(response: Response, fallbackUrl = ''): Promise<WikiPage> {
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Wiki API ${response.status}: ${text.slice(0, 300)}`)
    }

    const json = parseJsonRecord(text, 'write')
    const webui = stringOrUndefined(record(json._links).webui)
    const url = webui !== undefined && webui.length > 0 ? `${this.endpoint.baseUrl}${webui}` : fallbackUrl

    return {
      pageId: idText(json.id) ?? '',
      title: stringOrUndefined(json.title) ?? '',
      url,
      version: numberOrUndefined(record(json.version).number),
      spaceKey: stringOrUndefined(record(json.space).key),
      html: stringOrUndefined(record(record(json.body).storage).value) ?? '',
    }
  }
}

/** Parse an API body as a JSON object, naming the request on failure. */
function parseJsonRecord(text: string, context: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Wiki API returned a non-JSON response (${context}): ${text.slice(0, 200)}`)
  }
  return record(parsed)
}

/** View a parsed JSON node as a record; non-objects read as empty. */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

/** Narrow a parsed JSON field to a number, dropping every other type. */
function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/** Narrow a parsed JSON field to a string, dropping every other type. */
function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Render a JSON id field, which the API serves as a string or a number. */
function idText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}
