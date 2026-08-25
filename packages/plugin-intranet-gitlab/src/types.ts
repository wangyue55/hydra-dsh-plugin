/** Intranet GitLab domain types shared by the client and analysis modules. @module @hydra-dsh/plugin-intranet-gitlab/src/types */

/** Resolved GitLab REST endpoint: base URL without a trailing slash plus a private token. */
export interface GitlabEndpoint {
  /** API origin plus context path, no trailing slash. */
  baseUrl: string
  /** Token sent as the `PRIVATE-TOKEN` header. */
  token: string
}

/** One repository tree entry as served by the GitLab API. */
export interface GitlabTreeItem {
  /** Object id; absent on some server versions. */
  id?: string | undefined
  /** Entry basename. */
  name: string
  /** Repository-relative path. */
  path: string
  /** `tree` for directories, `blob` for files; the API may serve other kinds. */
  type: string
}

/** One project as served by the GitLab projects API. */
export interface GitlabProject {
  id: number
  name: string
  path: string
  path_with_namespace: string
  default_branch?: string | undefined
  web_url?: string | undefined
}

/** Project-search window with its truncation state. */
export interface GitlabProjectSearchResult {
  projects: GitlabProject[]
  truncated: boolean
}

/** One blob-search match; only `path` is guaranteed. */
export interface GitlabBlobSearchMatch {
  path: string
  filename?: string | undefined
  basename?: string | undefined
  data?: string | undefined
  startline?: number | undefined
}

/** Blob-search window with its truncation state. */
export interface GitlabBlobSearchResult {
  matches: GitlabBlobSearchMatch[]
  truncated: boolean
}

/** Project metadata the resolver hands every downstream stage. */
export interface ResolvedGitlabProject {
  /** Numeric project id as a string. */
  projectId: string
  /** Final path segment of the project. */
  projectName: string
  /** Full namespace path. */
  projectPath: string
  /** Default branch, or `null` when the project declares none. */
  defaultBranch: string | null
}

/** One bounded source file handed to the analyzer. */
export interface CodeFile {
  path: string
  language: string
  content: string
  /** UTF-8 byte size of `content`. */
  size: number
}
