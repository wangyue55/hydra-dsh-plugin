/**
 * Clue-driven code-scope discovery: blob searches from requirement hints,
 * verified against route/import evidence in the matched files, compared with
 * user-supplied paths. Ported from the hydra-agent discoverer; the search and
 * candidate budgets are caller-resolved.
 * @module @hydra-dsh/plugin-intranet-gitlab/src/code-scope-discoverer
 */

import { posix } from 'node:path'
import type { IntranetGitlabClient } from './gitlab-client.ts'
import type { GitlabBlobSearchMatch } from './types.ts'

/** Company-convention module-location guide checked alongside `CLAUDE.md`. */
const MODULE_GUIDE_PATH = 'docs/agent/模块代码定位指南.md'

/** Character cap on the probed `CLAUDE.md` content. */
const CLAUDE_PROBE_CHARS = 8_000
/** Character cap on the probed module-location guide content. */
const GUIDE_PROBE_CHARS = 16_000
/** Maximum additional guides followed from `CLAUDE.md` references. */
const MAX_LINKED_GUIDES = 3

/** Caller-resolved discovery budgets. */
export interface CodeScopeDiscoveryBudgets {
  /** Maximum distinct hint queries searched. */
  maxQueries: number
  /** Blob-search page size. */
  searchPerPage: number
  /** Blob-search pages per query before truncation. */
  searchMaxPages: number
  /** Maximum matched files whose content is probed for evidence. */
  maxCandidateFiles: number
  /** Maximum discovered paths reported. */
  maxDiscoveredPaths: number
}

/** Discovery request: the project, the ref, user paths, and requirement clues. */
export interface CodeScopeDiscoveryInput {
  projectId: string
  ref: string
  userPaths?: string[] | undefined
  moduleHints?: string[] | undefined
  routeHints?: string[] | undefined
  apiHints?: string[] | undefined
  uiTexts?: string[] | undefined
  changeDescription?: string | undefined
  signal?: AbortSignal | undefined
}

/** Discovery outcome: guidance files, verified scope, and the user-path comparison. */
export interface CodeScopeDiscoveryResult {
  /** Project guidance documents that exist and were applied. */
  guidanceFiles: string[]
  /** `confirmed` with reference evidence, `candidate` on hint match only, `unresolved` otherwise. */
  status: 'confirmed' | 'candidate' | 'unresolved'
  /** Human-readable per-file evidence lines. */
  evidence: string[]
  /** Every hint-matched path within the budgets. */
  discoveredPaths: string[]
  /** The scope handed to the reader: user paths plus confirmed supplements. */
  effectivePaths: string[]
  /** User paths versus discovered paths. */
  comparison: { overlap: string[]; userOnly: string[]; autoSupplement: string[] }
  /** Search and probe diagnostics. */
  warnings: string[]
  /** Whether any blob search was cut short by paging budgets. */
  truncated: boolean
}

/** Discover and verify the effective code scope for one analysis call. */
export class CodeScopeDiscoverer {
  constructor(
    private readonly client: IntranetGitlabClient,
    private readonly budgets: CodeScopeDiscoveryBudgets,
  ) {}

  /**
   * Run guidance probes, hint searches, and evidence checks.
   * @param input - project, ref, user paths, and clues.
   * @returns the discovery outcome.
   */
  async discover(input: CodeScopeDiscoveryInput): Promise<CodeScopeDiscoveryResult> {
    const warnings: string[] = []
    const queries = unique([
      ...input.moduleHints ?? [],
      ...input.routeHints ?? [],
      ...input.apiHints ?? [],
      ...input.uiTexts ?? [],
      ...input.changeDescription !== undefined && input.changeDescription !== '' ? [input.changeDescription] : [],
    ]).filter(item => item.length >= 2).slice(0, this.budgets.maxQueries)
    const read = (filePath: string): Promise<string | null> => this.client.getRawFileIfExists({
      projectId: input.projectId,
      ref: input.ref,
      filePath,
      signal: input.signal,
    })
    const [claudeResult, guideResult, ...searchResults] = await Promise.allSettled([
      read('CLAUDE.md'),
      read(MODULE_GUIDE_PATH),
      ...queries.map(search => this.client.searchBlobs({
        projectId: input.projectId,
        ref: input.ref,
        search,
        perPage: this.budgets.searchPerPage,
        maxPages: this.budgets.searchMaxPages,
        signal: input.signal,
      })),
    ])
    if (input.signal?.aborted) throw new Error('code scope discovery was cancelled')

    const claude = fulfilledValue(claudeResult)?.slice(0, CLAUDE_PROBE_CHARS) ?? null
    const guide = fulfilledValue(guideResult)?.slice(0, GUIDE_PROBE_CHARS) ?? null
    const guidanceFiles = claude !== null ? ['CLAUDE.md'] : []
    if (guide !== null && claude?.includes(posix.basename(MODULE_GUIDE_PATH)) === true) guidanceFiles.push(MODULE_GUIDE_PATH)
    if (claude !== null && guide !== null && !guidanceFiles.includes(MODULE_GUIDE_PATH)) {
      warnings.push(
        `The project has ${MODULE_GUIDE_PATH} but CLAUDE.md does not reference it; it was not applied as an entry rule`,
      )
    }
    if (claude !== null) {
      const otherGuides = extractMarkdownReferences(claude)
        .filter(path => path !== MODULE_GUIDE_PATH).slice(0, MAX_LINKED_GUIDES)
      const loadedGuides = await Promise.all(otherGuides.map(async path => ({ path, content: await read(path) })))
      for (const loaded of loadedGuides) if (loaded.content !== null) guidanceFiles.push(loaded.path)
    }

    const matches: GitlabBlobSearchMatch[] = []
    let truncated = false
    for (const result of searchResults) {
      if (result.status === 'fulfilled') {
        matches.push(...result.value.matches)
        truncated ||= result.value.truncated
      } else {
        warnings.push(`Code search failed: ${errorMessage(result.reason)}`)
      }
    }
    const candidates = unique(matches.map(item => normalizePath(item.path)))
      .filter(Boolean).sort(rankPath).slice(0, this.budgets.maxCandidateFiles)
    const contents = await Promise.all(candidates.map(async path => ({ path, content: await read(path) })))
    const evidence: string[] = []
    const confirmed = new Set<string>()
    const candidateSet = new Set<string>()
    const hintPattern = queries.length > 0 ? new RegExp(queries.map(escapeRegExp).join('|'), 'i') : null

    for (const file of contents) {
      if (file.content === null) continue
      /* v8 ignore next -- candidates only exist when queries ran, so the pattern is non-null here. */
      const isHintMatch = hintPattern?.test(file.content) ?? false
      if (!isHintMatch) continue
      candidateSet.add(file.path)
      const imports = extractImports(file.content, file.path)
      const routeEvidence = /\b(path|component|moduleName)\s*:/.test(file.content)
      if (routeEvidence && imports.length > 0) {
        confirmed.add(file.path)
        imports.forEach(path => confirmed.add(path))
        evidence.push(`${file.path}: hint matched, with route/module registration and dynamic-import references`)
      } else {
        evidence.push(`${file.path}: hint matched, but the reference-chain evidence is incomplete`)
      }
    }

    const discoveredPaths = unique([...confirmed, ...candidateSet]).slice(0, this.budgets.maxDiscoveredPaths)
    const userPaths = unique((input.userPaths ?? []).map(normalizePath).filter(Boolean))
    const overlap = userPaths.filter(path => discoveredPaths.some(auto => containsPath(path, auto)))
    const userOnly = userPaths.filter(path => !overlap.includes(path))
    const autoSupplement = discoveredPaths.filter(path => !userPaths.some(user => containsPath(user, path)))
    // User paths always stay; auto-discovery supplements only reference-proven
    // paths so the analyzed context does not balloon.
    const highConfidenceSupplement = autoSupplement.filter(path => confirmed.has(path))
    const effectivePaths = unique([...userPaths, ...highConfidenceSupplement])
    if (userPaths.length === 0) effectivePaths.push(...confirmed)

    return {
      guidanceFiles,
      status: confirmed.size > 0 ? 'confirmed' : candidateSet.size > 0 ? 'candidate' : 'unresolved',
      evidence,
      discoveredPaths,
      effectivePaths: unique(effectivePaths),
      comparison: { overlap, userOnly, autoSupplement },
      warnings,
      truncated,
    }
  }
}

/** Resolve relative dynamic-import targets against the importing file. */
function extractImports(content: string, sourcePath: string): string[] {
  const result: string[] = []
  for (const match of content.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    // The pattern always binds its group on a match.
    const value = match[1] as string
    if (!value.startsWith('.')) continue
    const resolved = posix.normalize(posix.join(posix.dirname(sourcePath), value))
    if (/\.(vue|tsx?|jsx?)$/.test(resolved)) result.push(resolved)
  }
  return unique(result)
}

/** Collect repo-relative `.md` link targets from a Markdown document. */
function extractMarkdownReferences(content: string): string[] {
  const paths: string[] = []
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+\.md)\)/gi)) {
    const rawPath = (match[1] as string).trim()
    if (!rawPath || rawPath.includes('..') || /^https?:/i.test(rawPath) || posix.isAbsolute(rawPath)) continue
    paths.push(normalizePath(rawPath))
  }
  return unique(paths)
}

/** Read a settled probe's value; a rejection reads as `null`. */
function fulfilledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null
}

/** Trimmed, de-duplicated, non-empty values in first-seen order. */
function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

/** Forward-slashed repository-relative path. */
function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+/, '')
}

/** Whether one path contains the other in either direction. */
function containsPath(parent: string, child: string): boolean {
  return parent === child
    || child.startsWith(`${parent.replace(/\/$/, '')}/`)
    || parent.startsWith(`${child.replace(/\/$/, '')}/`)
}

/** Router/module files first, then view/TS sources, then the rest. */
function rankPath(a: string, b: string): number {
  const score = (p: string): number => (/(^|\/)(router?|routes?|modules?)\b/i.test(p) ? 0 : /\.(vue|tsx?)$/.test(p) ? 1 : 2)
  return score(a) - score(b) || a.localeCompare(b)
}

/** Escape a literal for embedding into the combined hint pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Human-readable message for a settled rejection reason. */
function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
