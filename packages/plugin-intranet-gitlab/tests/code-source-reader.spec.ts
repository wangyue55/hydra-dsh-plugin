import { describe, expect, it } from 'vitest'
import { CodeSourceReader } from '../src/code-source-reader.ts'
import type { IntranetGitlabClient } from '../src/gitlab-client.ts'
import type { GitlabTreeItem } from '../src/types.ts'

const BUDGETS = { maxFiles: 60, maxFileChars: 50000, maxTotalChars: 180000, readConcurrency: 6 }

interface FakeRepo {
  files: Record<string, string>
  trees?: Record<string, GitlabTreeItem[]>
  treeError?: string
}

function fakeClient(repo: FakeRepo): IntranetGitlabClient {
  const fake = {
    getRepositoryTree: (input: { path?: string }) => {
      if (repo.treeError !== undefined) return Promise.reject(new Error(repo.treeError))
      return Promise.resolve(repo.trees?.[input.path ?? ''] ?? [])
    },
    getRawFile: (input: { filePath: string }) => {
      const content = repo.files[input.filePath]
      return content === undefined
        ? Promise.reject(new Error(`missing ${input.filePath}`))
        : Promise.resolve(content)
    },
  }
  return fake as unknown as IntranetGitlabClient
}

function read(repo: FakeRepo, paths: string[], budgets = BUDGETS) {
  return new CodeSourceReader(fakeClient(repo), budgets).read({
    projectId: '42',
    projectName: 'p',
    projectPath: 'g/p',
    ref: 'main',
    paths,
  })
}

describe('CodeSourceReader', () => {
  it('reads direct files and expands directories through the tree', async () => {
    const result = await read({
      files: { 'src/a.ts': 'export {}', 'src/dir/b.vue': '<template/>' },
      trees: { 'src/dir': [{ name: 'b.vue', path: 'src/dir/b.vue', type: 'blob' }] },
    }, ['src/a.ts', 'src/dir', 'src/a.ts'])
    expect(result.files.map(f => f.path)).toEqual(['src/a.ts', 'src/dir/b.vue'])
    expect(result.files[0]?.language).toBe('ts')
    expect(result.files[1]?.language).toBe('vue')
    expect(result.truncated).toBe(false)
  })

  it('skips sensitive and unsupported paths with a warning each', async () => {
    const result = await read({
      files: {},
      trees: { docs: [] },
    }, ['../escape.ts', 'secrets/.env', 'docs'])
    expect(result.files).toEqual([])
    expect(result.warnings[0]).toContain('Skipped an unsupported or sensitive path: ../escape.ts')
    expect(result.warnings[1]).toContain('Skipped an unsupported or sensitive path: secrets/.env')
    expect(result.warnings[2]).toContain('No analyzable code files were found')
  })

  it('filters ignored segments and non-code entries out of tree expansion', async () => {
    const result = await read({
      files: { 'src/ok.ts': 'x' },
      trees: {
        src: [
          { name: 'ok.ts', path: 'src/ok.ts', type: 'blob' },
          { name: 'dep.ts', path: 'src/node_modules/dep.ts', type: 'blob' },
          { name: 'img.png', path: 'src/img.png', type: 'blob' },
          { name: 'sub', path: 'src/sub', type: 'tree' },
        ],
      },
    }, ['src'])
    expect(result.files.map(f => f.path)).toEqual(['src/ok.ts'])
  })

  it('stops collecting at the file budget and reports truncation', async () => {
    const files: Record<string, string> = {}
    const tree: GitlabTreeItem[] = []
    for (let index = 0; index < 4; index++) {
      const path = `src/f${index}.ts`
      files[path] = 'x'
      tree.push({ name: `f${index}.ts`, path, type: 'blob' })
    }
    const result = await read({ files, trees: { src: tree } }, ['src'], { ...BUDGETS, maxFiles: 2 })
    expect(result.files).toHaveLength(2)
    expect(result.truncated).toBe(true)
    expect(result.warnings[0]).toContain('only the first 2 files')
  })

  it('stops direct-path collection at the file budget too', async () => {
    const result = await read(
      { files: { 'a.ts': 'x', 'b.ts': 'y' } },
      ['a.ts', 'b.ts'],
      { ...BUDGETS, maxFiles: 1 },
    )
    expect(result.files.map(f => f.path)).toEqual(['a.ts'])
    expect(result.truncated).toBe(true)
  })

  it('skips oversized files and cuts off at the total budget', async () => {
    const result = await read({
      files: { 'a.ts': 'x'.repeat(30), 'b.ts': 'ok', 'c.ts': 'tail' },
    }, ['a.ts', 'b.ts', 'c.ts'], { ...BUDGETS, maxFileChars: 10, maxTotalChars: 3 })
    expect(result.files.map(f => f.path)).toEqual(['b.ts'])
    expect(result.warnings.some(w => w.includes('exceeds the size limit'))).toBe(true)
    expect(result.warnings.some(w => w.includes('total code size exceeds'))).toBe(true)
    expect(result.truncated).toBe(true)
  })

  it('dedupes a directory entry already collected as a direct file', async () => {
    const result = await read({
      files: { 'src/a.ts': 'x' },
      trees: { src: [{ name: 'a.ts', path: 'src/a.ts', type: 'blob' }] },
    }, ['src/a.ts', 'src'])
    expect(result.files.map(f => f.path)).toEqual(['src/a.ts'])
  })

  it('tags every supported language, including the text fallback', async () => {
    const paths = ['a.tsx', 'a.jsx', 'a.js', 'a.cpp', 'a.h', 'a.qml', 'a.ui', 'a.pro', 'CMakeLists.txt', 'a.qrc']
    const files = Object.fromEntries(paths.map(path => [path, 'x']))
    const result = await read({ files }, paths)
    expect(result.files.map(f => f.language)).toEqual([
      'tsx', 'jsx', 'js', 'cpp', 'header', 'qml', 'ui', 'build', 'build', 'text',
    ])
  })

  it('stringifies a non-Error tree failure into the warning', async () => {
    const client = {
      getRepositoryTree: () => {
        // A foreign fetch implementation may reject with a bare value.
        // oxlint-disable-next-line prefer-promise-reject-errors
        return Promise.reject('tree exploded')
      },
      getRawFile: () => Promise.resolve(''),
    } as unknown as IntranetGitlabClient
    const result = await new CodeSourceReader(client, BUDGETS).read({
      projectId: '42',
      projectName: 'p',
      projectPath: 'g/p',
      ref: 'main',
      paths: ['dir'],
    })
    expect(result.warnings[0]).toContain('tree exploded')
  })

  it('records a tree failure as a warning and keeps going', async () => {
    const result = await read({ files: { 'a.ts': 'x' }, treeError: 'tree exploded' }, ['broken-dir', 'a.ts'])
    expect(result.files.map(f => f.path)).toEqual(['a.ts'])
    expect(result.warnings[0]).toContain('Failed to read path broken-dir: tree exploded')
  })

  it('rethrows a tree failure caused by cancellation', async () => {
    const controller = new AbortController()
    const client = {
      getRepositoryTree: () => {
        controller.abort()
        return Promise.reject(new Error('aborted'))
      },
      getRawFile: () => Promise.resolve(''),
    } as unknown as IntranetGitlabClient
    await expect(new CodeSourceReader(client, BUDGETS).read({
      projectId: '42',
      projectName: 'p',
      projectPath: 'g/p',
      ref: 'main',
      paths: ['dir'],
      signal: controller.signal,
    })).rejects.toThrow('aborted')
  })

  it('reads with bounded concurrency preserving input order', async () => {
    let inFlight = 0
    let peak = 0
    const client = {
      getRawFile: async (input: { filePath: string }) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise(resolve => setTimeout(resolve, 5))
        inFlight--
        return `content:${input.filePath}`
      },
    } as unknown as IntranetGitlabClient
    const paths = Array.from({ length: 6 }, (_, index) => `f${index}.ts`)
    const result = await new CodeSourceReader(client, { ...BUDGETS, readConcurrency: 2 }).read({
      projectId: '42',
      projectName: 'p',
      projectPath: 'g/p',
      ref: 'main',
      paths,
    })
    expect(peak).toBeLessThanOrEqual(2)
    expect(result.files.map(f => f.path)).toEqual(paths)
    expect(result.files[0]?.content).toBe('content:f0.ts')
  })
})
