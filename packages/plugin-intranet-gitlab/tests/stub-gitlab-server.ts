/**
 * Deterministic in-process GitLab v4 stub for the analysis tool tests: a real
 * `node:http` server so the shipping client's fetch path stays real while
 * only the remote endpoint is a stand-in.
 * @module
 */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/** One stubbed project record. */
export interface StubProject {
  id: number
  name: string
  path: string
  path_with_namespace: string
  default_branch?: string
}

/** Stub repository content: raw files plus a flat recursive tree per path prefix. */
export interface StubRepo {
  /** Raw file contents by repository-relative path. */
  files: Map<string, string>
  /** Blob-search matches by search term. */
  blobMatches: Map<string, string[]>
}

/** GitLab-style REST stub over real HTTP. */
export class StubGitlabServer {
  private readonly server: Server
  private readonly projects = new Map<string, StubProject>()
  readonly repo: StubRepo = { files: new Map(), blobMatches: new Map() }
  /** When set, every request waits this long before responding. */
  responseDelayMs = 0
  private baseUrlValue = ''

  constructor() {
    this.server = createServer((req, res) => {
      void this.handle(req, res)
    })
  }

  /** Serve one project by id and by namespace path. */
  addProject(project: StubProject): void {
    this.projects.set(String(project.id), project)
    this.projects.set(project.path_with_namespace, project)
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
    if (this.responseDelayMs > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, this.responseDelayMs))
    }
    const url = new URL(req.url ?? '/', this.baseUrlValue)

    if (url.pathname === '/api/v4/projects' && url.searchParams.has('search')) {
      const query = (url.searchParams.get('search') ?? '').toLowerCase()
      const seen = new Set<StubProject>()
      const hits = [...this.projects.values()].filter((project) => {
        if (seen.has(project)) return false
        seen.add(project)
        return project.path.toLowerCase().includes(query)
      })
      this.json(res, 200, hits)
      return
    }

    // Raw segments keep percent-encoding, so an encoded namespace path or file
    // path stays one segment until decoded here.
    const raw = url.pathname.split('/')
    if (raw[1] === 'api' && raw[2] === 'v4' && raw[3] === 'projects' && raw.length >= 5) {
      const project = this.projects.get(decodeURIComponent(raw[4] ?? ''))
      const rest = raw.slice(5)
      if (project === undefined) {
        res.statusCode = 404
        res.end('{"message":"404 Project Not Found"}')
        return
      }
      if (rest.length === 0) {
        this.json(res, 200, project)
        return
      }
      if (rest[0] === 'search' && url.searchParams.get('scope') === 'blobs') {
        const term = url.searchParams.get('search') ?? ''
        const paths = this.repo.blobMatches.get(term) ?? []
        this.json(res, 200, paths.map(path => ({ path })))
        return
      }
      if (rest[0] === 'repository' && rest[1] === 'files' && rest[rest.length - 1] === 'raw') {
        const filePath = decodeURIComponent(rest.slice(2, -1).join('/'))
        const content = this.repo.files.get(filePath)
        if (content === undefined) {
          res.statusCode = 404
          res.end('{"message":"404 File Not Found"}')
          return
        }
        res.statusCode = 200
        res.end(content)
        return
      }
      if (rest[0] === 'repository' && rest[1] === 'tree') {
        const path = url.searchParams.get('path') ?? ''
        const prefix = path === '' ? '' : `${path}/`
        const entries = [...this.repo.files.keys()]
          .filter(file => file.startsWith(prefix))
          .map(file => ({ name: file.split('/').pop() ?? file, path: file, type: 'blob' }))
        this.json(res, 200, entries)
        return
      }
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
