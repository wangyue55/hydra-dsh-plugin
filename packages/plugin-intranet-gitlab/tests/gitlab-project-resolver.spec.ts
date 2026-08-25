import { describe, expect, it } from 'vitest'
import { GitlabHttpError } from '../src/gitlab-client.ts'
import { resolveGitlabProject } from '../src/gitlab-project-resolver.ts'
import type { GitlabProjectLookup } from '../src/gitlab-project-resolver.ts'
import type { GitlabProject } from '../src/types.ts'

const PROJECT: GitlabProject = {
  id: 42,
  name: 'Heads H5',
  path: 'heads-h5',
  path_with_namespace: 'ficc/giant/heads-h5',
  default_branch: 'main',
}

const RESOLVED = {
  projectId: '42',
  projectName: 'heads-h5',
  projectPath: 'ficc/giant/heads-h5',
  defaultBranch: 'main',
}

function lookupWith(overrides: Partial<GitlabProjectLookup>): GitlabProjectLookup {
  return {
    baseUrl: 'http://git.example',
    getProject: () => Promise.reject(new Error('unexpected getProject')),
    searchProjects: () => Promise.reject(new Error('unexpected searchProjects')),
    ...overrides,
  }
}

describe('resolveGitlabProject', () => {
  it('rejects a blank locator and one that normalizes to nothing', async () => {
    await expect(resolveGitlabProject(lookupWith({}), '   ')).rejects.toThrow("'projectLocator' is required")
    await expect(resolveGitlabProject(lookupWith({}), ' /// ')).rejects.toThrow('must not be empty')
  })

  it('resolves a URL on the configured host to its namespace path', async () => {
    const lookup = lookupWith({
      getProject: (idOrPath) => {
        expect(idOrPath).toBe('ficc/giant/heads-h5')
        return Promise.resolve(PROJECT)
      },
    })
    await expect(resolveGitlabProject(lookup, 'http://git.example/ficc/giant/heads-h5/-/tree/main'))
      .resolves.toEqual(RESOLVED)
  })

  it('strips a configured base path and a .git suffix from URLs', async () => {
    const lookup = lookupWith({
      baseUrl: 'http://git.example/gitlab',
      getProject: (idOrPath) => {
        expect(idOrPath).toBe('ficc/giant/heads-h5')
        return Promise.resolve(PROJECT)
      },
    })
    await expect(resolveGitlabProject(lookup, 'http://git.example/gitlab/ficc/giant/heads-h5.git'))
      .resolves.toEqual(RESOLVED)
  })

  it('rejects a URL on a different host and an unparsable URL', async () => {
    await expect(resolveGitlabProject(lookupWith({}), 'http://other.example/x/y'))
      .rejects.toThrow('does not match the configured intranet GitLab host')
    await expect(resolveGitlabProject(lookupWith({ baseUrl: 'not a url' }), 'http://git.example/x'))
      .rejects.toThrow('Invalid GitLab project URL')
  })

  it('resolves a namespace path directly', async () => {
    const lookup = lookupWith({ getProject: () => Promise.resolve(PROJECT) })
    await expect(resolveGitlabProject(lookup, '/ficc/giant/heads-h5/')).resolves.toEqual(RESOLVED)
  })

  it('resolves a numeric id directly and falls back to name search on 404', async () => {
    const direct = lookupWith({ getProject: () => Promise.resolve(PROJECT) })
    await expect(resolveGitlabProject(direct, '42')).resolves.toEqual(RESOLVED)

    const fallback = lookupWith({
      getProject: () => Promise.reject(new GitlabHttpError('project', 404, 'nope')),
      searchProjects: () => Promise.resolve({ projects: [{ ...PROJECT, path: '42' }], truncated: false }),
    })
    await expect(resolveGitlabProject(fallback, '42')).resolves.toMatchObject({ projectId: '42' })

    const denied = lookupWith({
      getProject: () => Promise.reject(new GitlabHttpError('project', 403, 'no')),
    })
    await expect(resolveGitlabProject(denied, '42')).rejects.toThrow('GitLab project 403')
  })

  it('resolves a bare name to exactly one visible project path', async () => {
    const lookup = lookupWith({
      searchProjects: () => Promise.resolve({
        projects: [PROJECT, { ...PROJECT, id: 7, path: 'other' }],
        truncated: false,
      }),
    })
    await expect(resolveGitlabProject(lookup, 'HEADS-H5')).resolves.toEqual(RESOLVED)
  })

  it('rejects truncated, empty, and ambiguous name searches', async () => {
    const truncated = lookupWith({ searchProjects: () => Promise.resolve({ projects: [], truncated: true }) })
    await expect(resolveGitlabProject(truncated, 'heads-h5')).rejects.toThrow('search was truncated')

    const empty = lookupWith({ searchProjects: () => Promise.resolve({ projects: [], truncated: false }) })
    await expect(resolveGitlabProject(empty, 'heads-h5')).rejects.toThrow('No exact GitLab project path')

    const ambiguous = lookupWith({
      searchProjects: () => Promise.resolve({
        projects: [PROJECT, { ...PROJECT, id: 43, path_with_namespace: 'eq/heads-h5' }],
        truncated: false,
      }),
    })
    await expect(resolveGitlabProject(ambiguous, 'heads-h5')).rejects.toThrow('matched multiple projects')
  })

  it('serves a null default branch when the project declares none', async () => {
    const lookup = lookupWith({
      getProject: () => Promise.resolve({ ...PROJECT, default_branch: undefined }),
    })
    await expect(resolveGitlabProject(lookup, 'ficc/giant/heads-h5'))
      .resolves.toMatchObject({ defaultBranch: null })
  })
})
