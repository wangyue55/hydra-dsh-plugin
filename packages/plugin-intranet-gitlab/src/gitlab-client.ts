/**
 * GitLab v4 REST client for the intranet instance. Ported from the
 * hydra-agent internal client; every request honors the caller's
 * `AbortSignal` and the injectable `fetchFn` is the test seam for the network
 * boundary.
 * @module @hydra-dsh/plugin-intranet-gitlab/src/gitlab-client
 */

import type {
  GitlabBlobSearchMatch,
  GitlabBlobSearchResult,
  GitlabEndpoint,
  GitlabProject,
  GitlabProjectSearchResult,
  GitlabTreeItem,
} from './types.ts'

/** HTTP failure from one named GitLab resource, keeping the status observable. */
export class GitlabHttpError extends Error {
  constructor(
    resource: string,
    /** HTTP status the API answered with. */
    readonly status: number,
    body: string,
  ) {
    super(`GitLab ${resource} ${status}: ${body.slice(0, 300)}`)
    this.name = 'GitlabHttpError'
  }
}

/** Constructor options for {@link IntranetGitlabClient}. */
export interface IntranetGitlabClientOptions {
  /** Fetch implementation; defaults to the global `fetch`. */
  fetchFn?: typeof fetch | undefined
}

/** Paging window for {@link IntranetGitlabClient.searchProjects}. */
export interface SearchProjectsOptions {
  /** Page size, clamped to [1, 100]. */
  perPage?: number | undefined
  /** Maximum pages fetched before reporting truncation; at least 1. */
  maxPages?: number | undefined
  /** Cancels the search when aborted. */
  signal?: AbortSignal | undefined
}

/**
 * Minimal GitLab v4 client over `fetch`. Methods throw {@link GitlabHttpError}
 * for HTTP failures and `Error` for malformed payloads; they never retry.
 */
export class IntranetGitlabClient {
  private readonly fetchFn: typeof fetch

  constructor(
    private readonly endpoint: GitlabEndpoint,
    options: IntranetGitlabClientOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch
  }

  /** API origin the resolver compares project URLs against. */
  get baseUrl(): string {
    return this.endpoint.baseUrl
  }

  /**
   * Fetch one project by numeric id or namespace path.
   * @param projectIdOrPath - numeric id or full namespace path.
   * @param signal - cancels the request when aborted.
   * @returns the project.
   */
  async getProject(projectIdOrPath: string, signal?: AbortSignal): Promise<GitlabProject> {
    const url = new URL(
      `${this.endpoint.baseUrl}/api/v4/projects/${encodeURIComponent(projectIdOrPath)}`,
    )
    const response = await this.fetchFn(url, { headers: this.headers(), signal: signal ?? null })
    const text = await response.text()
    if (!response.ok) {
      throw new GitlabHttpError('project', response.status, text)
    }
    return parseProject(text, 'project')
  }

  /**
   * Search visible projects by name, following `X-Next-Page` paging.
   * @param query - project search term.
   * @param options - paging window and cancellation.
   * @returns the collected window and whether paging was cut short.
   */
  async searchProjects(
    query: string,
    options: SearchProjectsOptions = {},
  ): Promise<GitlabProjectSearchResult> {
    const perPage = Math.min(Math.max(options.perPage ?? 100, 1), 100)
    const maxPages = Math.max(options.maxPages ?? 5, 1)
    const projects: GitlabProject[] = []
    let page = 1
    let pagesFetched = 0

    while (pagesFetched < maxPages) {
      const url = new URL(`${this.endpoint.baseUrl}/api/v4/projects`)
      url.searchParams.set('search', query)
      url.searchParams.set('simple', 'true')
      url.searchParams.set('per_page', String(perPage))
      url.searchParams.set('page', String(page))

      const response = await this.fetchFn(url, { headers: this.headers(), signal: options.signal ?? null })
      const text = await response.text()
      if (!response.ok) {
        throw new GitlabHttpError('project search', response.status, text)
      }
      pagesFetched++
      projects.push(...parseProjectList(text))

      const nextPage = response.headers.get('X-Next-Page')?.trim() ?? ''
      if (!nextPage) return { projects, truncated: false }
      if (pagesFetched === maxPages) return { projects, truncated: true }
      const parsedNextPage = Number(nextPage)
      page = Number.isInteger(parsedNextPage) && parsedNextPage > page
        ? parsedNextPage
        : page + 1
    }

    /* v8 ignore next 2 -- the loop exits through one of the three returns above. */
    return { projects, truncated: true }
  }

  /**
   * Read one file's raw content at a ref.
   * @param input - project, ref, and repository-relative path.
   * @returns the raw file text.
   */
  async getRawFile(input: {
    projectId: string
    ref: string
    filePath: string
    signal?: AbortSignal | undefined
  }): Promise<string> {
    const url = new URL(
      `${this.endpoint.baseUrl}/api/v4/projects/${encodeURIComponent(
        input.projectId,
      )}/repository/files/${encodeURIComponent(input.filePath)}/raw`,
    )
    url.searchParams.set('ref', input.ref)

    const response = await this.fetchFn(url, { headers: this.headers(), signal: input.signal ?? null })
    const text = await response.text()
    if (!response.ok) {
      throw new GitlabHttpError('raw file', response.status, text)
    }
    return text
  }

  /**
   * Read one file's raw content, mapping a 404 to `null`.
   * @param input - project, ref, and repository-relative path.
   * @returns the raw file text, or `null` when the file does not exist.
   */
  async getRawFileIfExists(input: {
    projectId: string
    ref: string
    filePath: string
    signal?: AbortSignal | undefined
  }): Promise<string | null> {
    try {
      return await this.getRawFile(input)
    } catch (error) {
      if (error instanceof GitlabHttpError && error.status === 404) return null
      throw error
    }
  }

  /**
   * Search blob contents at a ref, following `X-Next-Page` paging.
   * @param input - project, ref, search term, and paging window.
   * @returns matched blobs and whether paging was cut short.
   */
  async searchBlobs(input: {
    projectId: string
    ref: string
    search: string
    perPage?: number | undefined
    maxPages?: number | undefined
    signal?: AbortSignal | undefined
  }): Promise<GitlabBlobSearchResult> {
    const perPage = Math.min(Math.max(input.perPage ?? 20, 1), 100)
    const maxPages = Math.max(input.maxPages ?? 2, 1)
    const matches: GitlabBlobSearchMatch[] = []
    let page = 1

    for (let pagesFetched = 0; pagesFetched < maxPages; pagesFetched++) {
      const url = new URL(
        `${this.endpoint.baseUrl}/api/v4/projects/${encodeURIComponent(input.projectId)}/search`,
      )
      url.searchParams.set('scope', 'blobs')
      url.searchParams.set('search', input.search)
      url.searchParams.set('ref', input.ref)
      url.searchParams.set('per_page', String(perPage))
      url.searchParams.set('page', String(page))
      const response = await this.fetchFn(url, { headers: this.headers(), signal: input.signal ?? null })
      const text = await response.text()
      if (!response.ok) throw new GitlabHttpError('blob search', response.status, text)
      const value = JSON.parse(text) as unknown
      if (!Array.isArray(value)) throw new Error('GitLab blob search returned an invalid payload')
      matches.push(...value.filter(isBlobSearchMatch))
      const nextPage = response.headers.get('X-Next-Page')?.trim() ?? ''
      if (!nextPage) return { matches, truncated: false }
      if (pagesFetched + 1 === maxPages) return { matches, truncated: true }
      page = Number(nextPage) || page + 1
    }
    /* v8 ignore next 2 -- the loop exits through one of the three returns above. */
    return { matches, truncated: true }
  }

  /**
   * List one repository-tree window at a ref.
   * @param input - project, ref, subtree path, recursion, and page size.
   * @returns the tree entries.
   */
  async getRepositoryTree(input: {
    projectId: string
    ref: string
    path?: string | undefined
    recursive?: boolean | undefined
    perPage?: number | undefined
    signal?: AbortSignal | undefined
  }): Promise<GitlabTreeItem[]> {
    const url = new URL(
      `${this.endpoint.baseUrl}/api/v4/projects/${encodeURIComponent(
        input.projectId,
      )}/repository/tree`,
    )
    url.searchParams.set('ref', input.ref)
    if (input.path !== undefined && input.path.length > 0) url.searchParams.set('path', input.path)
    if (input.recursive === true) url.searchParams.set('recursive', 'true')
    url.searchParams.set('per_page', String(input.perPage ?? 100))

    const response = await this.fetchFn(url, { headers: this.headers(), signal: input.signal ?? null })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`GitLab repository tree ${response.status}: ${text.slice(0, 300)}`)
    }
    return JSON.parse(text) as GitlabTreeItem[]
  }

  private headers(): Record<string, string> {
    return {
      'Accept': 'application/json',
      'PRIVATE-TOKEN': this.endpoint.token,
    }
  }
}

/** Keep only matches carrying the guaranteed `path` field. */
function isBlobSearchMatch(value: unknown): value is GitlabBlobSearchMatch {
  return !!value && typeof value === 'object' && typeof (value as { path?: unknown }).path === 'string'
}

/** Parse a project payload, naming the resource on failure. */
function parseProject(text: string, resource: string): GitlabProject {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`GitLab ${resource} returned invalid JSON: ${text.slice(0, 200)}`)
  }
  if (!isGitlabProject(value)) {
    throw new Error(`GitLab ${resource} returned an invalid project payload`)
  }
  return value
}

/** Parse a project-list payload, rejecting malformed entries. */
function parseProjectList(text: string): GitlabProject[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`GitLab project search returned invalid JSON: ${text.slice(0, 200)}`)
  }
  if (!Array.isArray(value) || !value.every(isGitlabProject)) {
    throw new Error('GitLab project search returned an invalid project list')
  }
  return value
}

/** Structural check for the project fields every stage relies on. */
function isGitlabProject(value: unknown): value is GitlabProject {
  if (!value || typeof value !== 'object') return false
  const project = value as Record<string, unknown>
  return typeof project.id === 'number'
    && typeof project.name === 'string'
    && typeof project.path === 'string'
    && typeof project.path_with_namespace === 'string'
}
