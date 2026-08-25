/**
 * Bounded source acquisition: expand directory paths through the repository
 * tree, filter to supported and safe code files, and read them concurrently
 * within file-count and character budgets. Ported from the hydra-agent
 * reader; the budgets are caller-resolved.
 * @module @hydra-dsh/plugin-intranet-gitlab/src/code-source-reader
 */

import type { IntranetGitlabClient } from './gitlab-client.ts'
import type { CodeFile, GitlabTreeItem } from './types.ts'

/** Read request: the resolved project, ref, and effective paths. */
export interface CodeSourceInput {
  projectId: string
  projectName: string
  projectPath: string
  ref: string
  paths: string[]
  projectType?: 'auto' | 'node' | 'vue' | 'react' | 'qt' | undefined
  signal?: AbortSignal | undefined
}

/** Caller-resolved acquisition budgets. */
export interface CodeSourceReaderBudgets {
  /** Maximum files read across every path. */
  maxFiles: number
  /** Per-file character cap; larger files are skipped. */
  maxFileChars: number
  /** Whole-call character cap; later files are skipped once reached. */
  maxTotalChars: number
  /** Concurrent raw-file reads. */
  readConcurrency: number
}

/** Bounded read outcome. */
export interface CodeSourceReadResult {
  files: CodeFile[]
  warnings: string[]
  truncated: boolean
}

const SUPPORTED_SUFFIXES = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.cpp',
  '.cc',
  '.cxx',
  '.h',
  '.hpp',
  '.qml',
  '.ui',
  '.pro',
  '.pri',
  '.qrc',
  'CMakeLists.txt',
]

const IGNORED_SEGMENTS = [
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '.next',
  '.nuxt',
  'build',
  'debug',
  'release',
  '.generated',
]

const IGNORED_SUFFIXES = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.map',
  '.log',
  '.env',
  '.pem',
  '.key',
  '.p12',
  '.crt',
  '.o',
  '.obj',
  '.dll',
  '.so',
  '.dylib',
  '.exe',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
]

/** Expand, filter, and read the effective scope within the budgets. */
export class CodeSourceReader {
  constructor(
    private readonly client: IntranetGitlabClient,
    private readonly budgets: CodeSourceReaderBudgets,
  ) {}

  /**
   * Read every supported file under the requested paths.
   * @param input - resolved project, ref, and effective paths.
   * @returns the bounded files plus skip diagnostics.
   */
  async read(input: CodeSourceInput): Promise<CodeSourceReadResult> {
    const warnings: string[] = []
    const files: CodeFile[] = []
    const candidates: string[] = []
    const seen = new Set<string>()
    let totalChars = 0
    let truncated = false

    const addCandidate = (filePath: string): boolean => {
      if (seen.has(filePath)) return true
      seen.add(filePath)
      if (candidates.length >= this.budgets.maxFiles) {
        warnings.push(`The file count exceeds the limit; only the first ${this.budgets.maxFiles} files are analyzed`)
        truncated = true
        return false
      }
      candidates.push(filePath)
      return true
    }

    for (const path of normalizePaths(input.paths)) {
      if (!isSafeCodePath(path)) {
        warnings.push(`Skipped an unsupported or sensitive path: ${path}`)
        continue
      }

      if (isSupportedCodePath(path)) {
        const shouldContinue = addCandidate(path)
        if (!shouldContinue) break
        continue
      }

      let tree: GitlabTreeItem[]
      try {
        tree = await this.client.getRepositoryTree({
          projectId: input.projectId,
          ref: input.ref,
          path,
          recursive: true,
          perPage: 100,
          signal: input.signal,
        })
      } catch (err) {
        if (input.signal?.aborted) throw err
        warnings.push(`Failed to read path ${path}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }

      const blobs = tree.filter(isCodeBlob)
      if (blobs.length === 0) {
        warnings.push(`No analyzable code files were found under the path: ${path}`)
        continue
      }

      let budgetHit = false
      for (const item of blobs) {
        if (!addCandidate(item.path)) {
          budgetHit = true
          break
        }
      }
      if (budgetHit) break
    }

    const loaded = await mapWithConcurrency(candidates, this.budgets.readConcurrency, async filePath => ({
      filePath,
      content: await this.client.getRawFile({
        projectId: input.projectId,
        ref: input.ref,
        filePath,
        signal: input.signal,
      }),
    }))
    for (const { filePath, content } of loaded) {
      const size = Buffer.byteLength(content, 'utf-8')
      if (content.length > this.budgets.maxFileChars) {
        warnings.push(`A file exceeds the size limit and was skipped: ${filePath}`)
        continue
      }
      if (totalChars + content.length > this.budgets.maxTotalChars) {
        warnings.push('The total code size exceeds the limit; the remaining files were skipped')
        truncated = true
        break
      }
      totalChars += content.length
      files.push({ path: filePath, language: getLanguage(filePath), content, size })
    }
    return { files, warnings, truncated }
  }
}

/** Map values with a fixed worker pool, preserving input order. */
async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (next < values.length) {
      const index = next++
      results[index] = await mapper(values[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}

/** Trimmed, forward-slashed, de-duplicated non-empty paths. */
function normalizePaths(paths: string[]): string[] {
  return Array.from(
    new Set(
      paths
        .map(p => p.trim().replace(/\\/g, '/').replace(/^\/+/, ''))
        .filter(Boolean),
    ),
  )
}

/** Whether a tree entry is a readable, supported code file. */
function isCodeBlob(item: GitlabTreeItem): boolean {
  return item.type === 'blob' && isSafeCodePath(item.path) && isSupportedCodePath(item.path)
}

/** Reject escapes, ignored directories, and sensitive or binary suffixes. */
function isSafeCodePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.includes('..')) return false
  const parts = normalized.split('/')
  if (parts.some(part => IGNORED_SEGMENTS.includes(part))) return false
  return !IGNORED_SUFFIXES.some(suffix => normalized.endsWith(suffix))
}

/** Whether the path carries one of the supported code suffixes. */
function isSupportedCodePath(path: string): boolean {
  return SUPPORTED_SUFFIXES.some(suffix => path.endsWith(suffix))
}

/** Coarse language tag for one file path. */
function getLanguage(path: string): string {
  if (path.endsWith('.tsx')) return 'tsx'
  if (path.endsWith('.ts')) return 'ts'
  if (path.endsWith('.jsx')) return 'jsx'
  if (path.endsWith('.js')) return 'js'
  if (path.endsWith('.vue')) return 'vue'
  if (/\.(cpp|cc|cxx)$/.test(path)) return 'cpp'
  if (/\.(h|hpp)$/.test(path)) return 'header'
  if (path.endsWith('.qml')) return 'qml'
  if (path.endsWith('.ui')) return 'ui'
  if (/\.(pro|pri)$/.test(path) || path.endsWith('CMakeLists.txt')) return 'build'
  return 'text'
}
