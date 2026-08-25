/**
 * Deterministic in-process Confluence-style stub for the wiki tool tests: a
 * real `node:http` server so the shipping client's fetch path stays real while
 * only the remote endpoint is a stand-in.
 * @module
 */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/** One stubbed page record served by {@link StubWikiServer}. */
export interface StubPage {
  id: string
  title: string
  version?: number
  spaceKey?: string
  storageHtml: string
  childIds?: string[]
  /** Omit the web link from every payload naming this page. */
  noLink?: boolean
}

/** One recorded write request body for assertions. */
export interface RecordedWrite {
  method: string
  path: string
  body: Record<string, unknown>
}

/** JSON page payload in the wire layout the client parses. */
function pagePayload(page: StubPage): Record<string, unknown> {
  return {
    id: page.id,
    title: page.title,
    ...page.version === undefined ? {} : { version: { number: page.version } },
    ...page.spaceKey === undefined ? {} : { space: { key: page.spaceKey } },
    body: { storage: { value: page.storageHtml } },
    _links: page.noLink === true ? {} : { webui: `/pages/viewpage.action?pageId=${page.id}` },
  }
}

/** Confluence-style REST stub over real HTTP, with recorded writes. */
export class StubWikiServer {
  private readonly server: Server
  private readonly pages = new Map<string, StubPage>()
  /** Writes received, oldest first. */
  readonly writes: RecordedWrite[] = []
  /** When set, every request waits this long before responding. */
  responseDelayMs = 0
  /** When set, page-body GETs wait this long; child listings stay fast. */
  bodyDelayMs = 0
  /** When set, every request is answered with this status and plain-text body. */
  failure: { status: number; body: string } | undefined
  /** Page ids whose body reads 500 while they stay listed as children. */
  failBodyIds: string[] = []
  /** When true, POST/PUT answer `{}` so writes carry no echo fields. */
  blankWriteResponse = false
  private baseUrlValue = ''

  constructor() {
    this.server = createServer((req, res) => {
      void this.handle(req, res)
    })
  }

  /** Serve one page record (and its children when `childIds` is set). */
  addPage(page: StubPage): void {
    this.pages.set(page.id, page)
  }

  /** `http://127.0.0.1:<port>` once listening. */
  get baseUrl(): string {
    return this.baseUrlValue
  }

  /** Start listening on an ephemeral loopback port. */
  async listen(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.listen(0, '127.0.0.1', resolve)
    })
    const address = this.server.address()
    if (address === null || typeof address === 'string') throw new Error('stub server address unavailable')
    this.baseUrlValue = `http://127.0.0.1:${address.port}`
  }

  /** Stop listening and drop every open connection. */
  async close(): Promise<void> {
    this.server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    if (this.responseDelayMs > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, this.responseDelayMs))
    }
    if (this.failure !== undefined) {
      res.statusCode = this.failure.status
      res.end(this.failure.body)
      return
    }
    const url = new URL(req.url ?? '/', this.baseUrlValue)
    const childMatch = url.pathname.match(/^\/rest\/api\/content\/([^/]+)\/child\/page$/)
    if (req.method === 'GET' && childMatch !== null) {
      const parent = this.pages.get(decodeURIComponent(childMatch[1] ?? ''))
      // A listed id without a page record stays listed: its body read 404s,
      // which is how tests model a discoverable-but-unreadable child.
      this.json(res, 200, {
        results: (parent?.childIds ?? []).map((id) => {
          const child = this.pages.get(id)
          return {
            id,
            title: child?.title ?? id,
            ...child?.version === undefined ? {} : { version: { number: child.version } },
            _links: child?.noLink === true ? {} : { webui: `/pages/viewpage.action?pageId=${id}` },
          }
        }),
        _links: {},
      })
      return
    }
    const pageMatch = url.pathname.match(/^\/rest\/api\/content\/([^/]+)$/)
    if (req.method === 'GET' && pageMatch !== null) {
      const id = decodeURIComponent(pageMatch[1] ?? '')
      if (this.bodyDelayMs > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, this.bodyDelayMs))
      }
      if (this.failBodyIds.includes(id)) {
        res.statusCode = 500
        res.end('body read refused')
        return
      }
      const page = this.pages.get(id)
      if (page === undefined) {
        res.statusCode = 404
        res.end('no such page')
        return
      }
      this.json(res, 200, pagePayload(page))
      return
    }
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {}
    if (req.method === 'POST' && url.pathname === '/rest/api/content') {
      this.writes.push({ method: 'POST', path: url.pathname, body })
      if (this.blankWriteResponse) {
        this.json(res, 200, {})
        return
      }
      const created: StubPage = {
        id: 'created-1',
        title: typeof body.title === 'string' ? body.title : '',
        version: 1,
        spaceKey: 'SP',
        storageHtml: '',
      }
      this.json(res, 200, pagePayload(created))
      return
    }
    if (req.method === 'PUT' && pageMatch !== null) {
      this.writes.push({ method: 'PUT', path: url.pathname, body })
      if (this.blankWriteResponse) {
        this.json(res, 200, {})
        return
      }
      const versionRecord = body.version as { number?: number } | undefined
      const updated: StubPage = {
        id: decodeURIComponent(pageMatch[1] ?? ''),
        title: typeof body.title === 'string' ? body.title : '',
        version: versionRecord?.number ?? 0,
        storageHtml: '',
      }
      this.json(res, 200, pagePayload(updated))
      return
    }
    res.statusCode = 404
    res.end('unhandled route')
  }

  private json(res: ServerResponse, status: number, value: unknown): void {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(value))
  }
}
