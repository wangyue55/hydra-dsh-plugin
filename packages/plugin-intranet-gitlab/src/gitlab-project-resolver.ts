/**
 * Project-locator resolution: numeric id, final project name, full namespace
 * path, or an intranet GitLab URL, resolved to canonical project metadata.
 * Ported from the hydra-agent resolver.
 * @module @hydra-dsh/plugin-intranet-gitlab/src/gitlab-project-resolver
 */

import { GitlabHttpError } from './gitlab-client.ts'
import type { GitlabProject, GitlabProjectSearchResult, ResolvedGitlabProject } from './types.ts'

/** The client operations the resolver needs; the full client satisfies it. */
export interface GitlabProjectLookup {
  /** API origin project URLs must live on. */
  baseUrl: string
  /** Fetch one project by id or namespace path. */
  getProject(projectIdOrPath: string, signal?: AbortSignal): Promise<GitlabProject>
  /** Search visible projects by name. */
  searchProjects(query: string, options?: { signal?: AbortSignal | undefined }): Promise<GitlabProjectSearchResult>
}

/**
 * Resolve one project locator to canonical metadata. A URL must live on the
 * configured host; a bare name must match exactly one visible project path.
 * @param lookup - project lookup operations.
 * @param projectLocator - id, name, namespace path, or URL.
 * @param signal - cancels in-flight lookups when aborted.
 * @returns the resolved project.
 */
export async function resolveGitlabProject(
  lookup: GitlabProjectLookup,
  projectLocator: string,
  signal?: AbortSignal,
): Promise<ResolvedGitlabProject> {
  const locator = projectLocator.trim()
  if (!locator) throw new Error("'projectLocator' is required and must be a string")

  const urlPath = extractProjectPathFromUrl(locator, lookup.baseUrl)
  if (urlPath !== null) return toResolved(await lookup.getProject(urlPath, signal))

  const normalized = normalizeLocator(locator)
  if (!normalized) throw new Error("'projectLocator' is required and must not be empty")
  if (normalized.includes('/')) {
    return toResolved(await lookup.getProject(normalized, signal))
  }

  if (/^\d+$/.test(normalized)) {
    try {
      return toResolved(await lookup.getProject(normalized, signal))
    } catch (error) {
      if (!(error instanceof GitlabHttpError) || error.status !== 404) throw error
    }
  }

  return resolveByName(lookup, normalized, signal)
}

/** Extract the namespace path from a project URL on the configured host, or `null` for a non-URL locator. */
function extractProjectPathFromUrl(value: string, baseUrl: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null

  let inputUrl: URL
  let configuredUrl: URL
  try {
    inputUrl = new URL(value)
    configuredUrl = new URL(baseUrl)
  } catch {
    throw new Error(`Invalid GitLab project URL: ${value}`)
  }
  if (inputUrl.host.toLowerCase() !== configuredUrl.host.toLowerCase()) {
    throw new Error('GitLab URL host does not match the configured intranet GitLab host')
  }

  let path = decodeURIComponent(inputUrl.pathname)
  const basePath = configuredUrl.pathname.replace(/^\/+|\/+$/g, '')
  path = path.replace(/^\/+/, '')
  if (basePath && path.startsWith(`${basePath}/`)) path = path.slice(basePath.length + 1)
  // A split never yields an empty array, so the first segment exists.
  path = path.split('/-/', 1)[0] as string
  return normalizeLocator(path)
}

/** Strip surrounding slashes and a trailing `.git` from a locator. */
function normalizeLocator(value: string): string {
  return value
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
}

/** Resolve a bare project name to exactly one visible project path. */
async function resolveByName(
  lookup: GitlabProjectLookup,
  projectName: string,
  signal?: AbortSignal,
): Promise<ResolvedGitlabProject> {
  const result = await lookup.searchProjects(projectName, { signal })
  if (result.truncated) {
    throw new Error(
      `GitLab project search was truncated for '${projectName}'. Please provide a project ID or full namespace path.`,
    )
  }

  const normalizedName = projectName.toLowerCase()
  const exactMatches = result.projects.filter(
    project => normalizeLocator(project.path).toLowerCase() === normalizedName,
  )
  const first = exactMatches[0]
  if (first === undefined) {
    throw new Error(
      `No exact GitLab project path '${projectName}' was found among projects visible to the configured credentials.`,
    )
  }
  if (exactMatches.length > 1) {
    const candidates = exactMatches
      .slice(0, 10)
      .map(project => `${project.path_with_namespace} (id=${project.id})`)
      .join(', ')
    throw new Error(
      `GitLab project name '${projectName}' matched multiple projects: ${candidates}. Please provide a project ID or full namespace path.`,
    )
  }
  return toResolved(first)
}

/** Project payload reduced to the metadata every downstream stage uses. */
function toResolved(project: GitlabProject): ResolvedGitlabProject {
  return {
    projectId: String(project.id),
    projectName: project.path,
    projectPath: project.path_with_namespace,
    defaultBranch: project.default_branch ?? null,
  }
}
