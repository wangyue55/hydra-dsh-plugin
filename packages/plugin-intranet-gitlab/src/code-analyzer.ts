/**
 * Lightweight static impact analysis over the bounded files: per-file
 * imports, exports, symbols, API calls, and routes, aggregated into
 * component/service/DTO views and inferred side effects. Ported from the
 * hydra-agent analyzer; per-list extraction caps are algorithm internals and
 * stay fixed.
 * @module @hydra-dsh/plugin-intranet-gitlab/src/code-analyzer
 */

import type { CodeSourceInput } from './code-source-reader.ts'
import type { CodeFile } from './types.ts'

/** Aggregated analysis over one bounded read. */
export interface CodeAnalysisResult {
  /** The analyzed scope, echoing the resolved project and paths. */
  source: {
    projectId: string
    projectName: string
    projectPath: string
    ref: string
    paths: string[]
    projectType: 'auto' | 'node' | 'vue' | 'react' | 'qt'
  }
  fileCount: number
  files: {
    path: string
    language: string
    size: number
    imports: string[]
    exports: string[]
    symbols: string[]
    apiCalls: string[]
    routes: string[]
  }[]
  apiCalls: string[]
  routes: string[]
  components: string[]
  services: string[]
  dtos: string[]
  dependencies: string[]
  sideEffects: string[]
}

/**
 * Analyze the read files into the aggregate impact views.
 * @param source - the analyzed scope.
 * @param files - bounded files from the reader.
 * @returns the aggregate analysis.
 */
export function analyzeCodeSource(
  source: CodeSourceInput,
  files: CodeFile[],
): CodeAnalysisResult {
  const summaries = files.map(summarizeFile)
  const apiCalls = unique(summaries.flatMap(f => f.apiCalls))
  const routes = unique(summaries.flatMap(f => f.routes))
  const dependencies = unique(summaries.flatMap(f => f.imports))

  return {
    source: {
      projectId: source.projectId,
      projectName: source.projectName,
      projectPath: source.projectPath,
      ref: source.ref,
      paths: source.paths,
      projectType: source.projectType ?? 'auto',
    },
    fileCount: files.length,
    files: summaries,
    apiCalls,
    routes,
    components: unique(
      summaries
        .filter(f => ['vue', 'tsx', 'jsx', 'qml', 'ui'].includes(f.language))
        .flatMap(f => (f.symbols.length > 0 ? f.symbols : [basename(f.path)])),
    ),
    services: unique(
      summaries
        .filter(f => /service|controller|api/i.test(f.path))
        .flatMap(f => (f.symbols.length > 0 ? f.symbols : [basename(f.path)])),
    ),
    dtos: unique(
      summaries
        .filter(f => /dto|type|interface/i.test(f.path))
        .flatMap(f => f.symbols),
    ),
    dependencies,
    sideEffects: inferSideEffects(apiCalls, routes),
  }
}

/** Per-file summary in the analysis result's `files` layout. */
function summarizeFile(file: CodeFile): CodeAnalysisResult['files'][number] {
  const content = file.content
  return {
    path: file.path,
    language: file.language,
    size: file.size,
    imports: extractImports(content),
    exports: extractExports(content),
    symbols: extractSymbols(content, file.path),
    apiCalls: extractApiCalls(content),
    routes: extractRoutes(content),
  }
}

/** Static and CommonJS import specifiers, capped at 40. */
function extractImports(content: string): string[] {
  const imports = [
    ...Array.from(content.matchAll(/import\s+[^'"]*from\s+["']([^"']+)["']/g)).map(m => group(m, 1)),
    ...Array.from(content.matchAll(/require\(["']([^"']+)["']\)/g)).map(m => group(m, 1)),
  ]
  return unique(imports).slice(0, 40)
}

/** Named export declarations, capped at 40. */
function extractExports(content: string): string[] {
  return unique(
    Array.from(
      content.matchAll(/export\s+(?:default\s+)?(?:class|function|const|interface|type)\s+([A-Za-z0-9_]+)/g),
    ).map(m => group(m, 1)),
  ).slice(0, 40)
}

/** Declared classes/functions/types, constant names, and `name:` literals, capped at 40. */
function extractSymbols(content: string, path: string): string[] {
  const symbols = [
    ...Array.from(content.matchAll(/\b(?:class|function|interface|type)\s+([A-Za-z0-9_]+)/g)).map(m => group(m, 1)),
    ...Array.from(content.matchAll(/\bconst\s+([A-Z][A-Za-z0-9_]*)\s*=/g)).map(m => group(m, 1)),
    ...Array.from(content.matchAll(/name:\s*["']([^"']+)["']/g)).map(m => group(m, 1)),
  ]
  if (symbols.length === 0 && path.endsWith('.vue')) symbols.push(basename(path))
  return unique(symbols).slice(0, 40)
}

/** Fetch/axios/request targets and `url:` literals, capped at 60. */
function extractApiCalls(content: string): string[] {
  const calls = [
    ...Array.from(content.matchAll(/\b(?:fetch|axios\.\w+|request)\(\s*["'`]([^"'`]+)["'`]/g)).map(m => group(m, 1)),
    ...Array.from(content.matchAll(/\burl\s*:\s*["']([^"']+)["']/g)).map(m => group(m, 1)),
  ]
  return unique(calls).slice(0, 60)
}

/** HTTP-verb decorators and `path:` literals, capped at 60. */
function extractRoutes(content: string): string[] {
  const routes = [
    ...Array.from(content.matchAll(/@(Get|Post|Put|Delete|Patch)\(["']?([^"')`]*)["']?\)/g)).map(
      m => `${group(m, 1).toUpperCase()} /${group(m, 2)}`.replace(/\/+$/, ''),
    ),
    ...Array.from(content.matchAll(/\bpath\s*:\s*["']([^"']+)["']/g)).map(m => group(m, 1)),
  ]
  return unique(routes).slice(0, 60)
}

/** Coarse side-effect conclusions from the aggregated calls and routes. */
function inferSideEffects(apiCalls: string[], routes: string[]): string[] {
  const effects: string[] = []
  if (apiCalls.length > 0) effects.push('calls frontend APIs or external services')
  if (routes.some(r => /POST|PUT|PATCH|DELETE/i.test(r))) effects.push('has write endpoints or state-changing entry points')
  return effects
}

/** A matched regex's capture group; the patterns above always bind their groups. */
function group(match: RegExpMatchArray, index: number): string {
  return match[index] as string
}

/** Trimmed, de-duplicated, non-empty values in first-seen order. */
function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(v => v.trim()).filter(Boolean)))
}

/** Extensionless basename of a path. */
function basename(path: string): string {
  const segments = path.split(/[\\/]/)
  // A split never yields an empty array, so the last segment exists.
  return (segments[segments.length - 1] as string).replace(/\.[^.]+$/, '')
}
