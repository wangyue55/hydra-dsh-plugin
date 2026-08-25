/**
 * The model-facing `intranet_gitlab_analyze_code_source` tool: resolve an
 * intranet GitLab project, discover and verify relevant code from requirement
 * clues, read the bounded effective scope, and return a lightweight impact
 * analysis. Configuration carries credential reference names and acquisition
 * budgets; values resolve per call. Named exports preserve loader injection
 * metadata.
 * @module @hydra-dsh/plugin-intranet-gitlab
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveGitlabEndpoint } from './credentials.ts'
import { IntranetGitlabClient } from './gitlab-client.ts'
import { resolveGitlabProject } from './gitlab-project-resolver.ts'
import { CodeScopeDiscoverer } from './code-scope-discoverer.ts'
import { CodeSourceReader } from './code-source-reader.ts'
import { analyzeCodeSource } from './code-analyzer.ts'

export type * from './types.ts'

export const name = 'intranet-tool-gitlab'
export const inject = ['tools']

/** Default credential reference naming the GitLab API base URL. */
const DEFAULT_BASE_URL_ENV = 'INTRANET_GITLAB_BASE_URL'
/** Default credential reference naming the GitLab private token. */
const DEFAULT_TOKEN_ENV = 'INTRANET_GITLAB_TOKEN'
/** Default cooperative deadline in milliseconds. */
const DEFAULT_TIMEOUT_MS = 60000
/** Default cap on each hint array after de-duplication. */
const DEFAULT_HINT_LIMIT = 10

/** Fully resolved discovery budgets. */
interface ResolvedDiscoveryBudgets {
  maxQueries: number
  searchPerPage: number
  searchMaxPages: number
  maxCandidateFiles: number
  maxDiscoveredPaths: number
}

/** Default discovery budgets; the values mirror the hydra-agent production defaults. */
const DEFAULT_DISCOVERY_BUDGETS: ResolvedDiscoveryBudgets = {
  maxQueries: 6,
  searchPerPage: 20,
  searchMaxPages: 2,
  maxCandidateFiles: 24,
  maxDiscoveredPaths: 30,
}

/** Fully resolved read budgets. */
interface ResolvedReadBudgets {
  maxFiles: number
  maxFileChars: number
  maxTotalChars: number
  readConcurrency: number
}

/** Default read budgets; the values mirror the hydra-agent production defaults. */
const DEFAULT_READ_BUDGETS: ResolvedReadBudgets = {
  maxFiles: 60,
  maxFileChars: 50000,
  maxTotalChars: 180000,
  readConcurrency: 6,
}

/** Discovery-budget configuration; omitted fields keep the hydra-agent production values. */
export interface DiscoveryBudgetConfig {
  /** Maximum distinct hint queries searched. */
  maxQueries?: number
  /** Blob-search page size. */
  searchPerPage?: number
  /** Blob-search pages per query before truncation. */
  searchMaxPages?: number
  /** Maximum matched files whose content is probed for evidence. */
  maxCandidateFiles?: number
  /** Maximum discovered paths reported. */
  maxDiscoveredPaths?: number
}

/** Read-budget configuration; omitted fields keep the hydra-agent production values. */
export interface ReadBudgetConfig {
  /** Maximum files read across every path. */
  maxFiles?: number
  /** Per-file character cap; larger files are skipped. */
  maxFileChars?: number
  /** Whole-call character cap; later files are skipped once reached. */
  maxTotalChars?: number
  /** Concurrent raw-file reads. */
  readConcurrency?: number
}

/** Intranet GitLab tool configuration; every field has a default. */
export interface Config {
  /** Credential reference naming the GitLab API base URL. */
  baseUrlEnv?: string
  /** Credential reference naming the GitLab private token. */
  tokenEnv?: string
  /** Cooperative deadline enforced by the timeout policy. */
  timeoutMs?: number
  /** Cap on each hint array after de-duplication. */
  hintLimit?: number
  /** Clue-search budgets. */
  discovery?: DiscoveryBudgetConfig
  /** Source-acquisition budgets. */
  read?: ReadBudgetConfig
}

/**
 * Schemastery configuration for the intranet GitLab tool consumer. Defaults
 * are declared here as well as in {@link resolveConfig} so configuration
 * surfaces render the resolved section; both read the same constants.
 */
export const Config: z<Config> = z.object({
  baseUrlEnv: z.string().role('credential-ref').default(DEFAULT_BASE_URL_ENV),
  tokenEnv: z.string().role('credential-ref').default(DEFAULT_TOKEN_ENV),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
  hintLimit: z.number().step(1).min(1).default(DEFAULT_HINT_LIMIT),
  discovery: z.object({
    maxQueries: z.number().step(1).min(1).default(DEFAULT_DISCOVERY_BUDGETS.maxQueries),
    searchPerPage: z.number().step(1).min(1).default(DEFAULT_DISCOVERY_BUDGETS.searchPerPage),
    searchMaxPages: z.number().step(1).min(1).default(DEFAULT_DISCOVERY_BUDGETS.searchMaxPages),
    maxCandidateFiles: z.number().step(1).min(1).default(DEFAULT_DISCOVERY_BUDGETS.maxCandidateFiles),
    maxDiscoveredPaths: z.number().step(1).min(1).default(DEFAULT_DISCOVERY_BUDGETS.maxDiscoveredPaths),
  }),
  read: z.object({
    maxFiles: z.number().step(1).min(1).default(DEFAULT_READ_BUDGETS.maxFiles),
    maxFileChars: z.number().step(1).min(1).default(DEFAULT_READ_BUDGETS.maxFileChars),
    maxTotalChars: z.number().step(1).min(1).default(DEFAULT_READ_BUDGETS.maxTotalChars),
    readConcurrency: z.number().step(1).min(1).default(DEFAULT_READ_BUDGETS.readConcurrency),
  }),
})

/** Fully resolved configuration the tool body reads. */
interface ResolvedConfig {
  baseUrlEnv: string
  tokenEnv: string
  timeoutMs: number
  hintLimit: number
  discovery: ResolvedDiscoveryBudgets
  read: ResolvedReadBudgets
}

/**
 * Resolve the raw plugin config into the values the tool runs with; every
 * default lives in the module constants the schema also declares.
 * @param config - raw plugin config.
 * @returns the resolved configuration.
 */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    baseUrlEnv: config.baseUrlEnv ?? DEFAULT_BASE_URL_ENV,
    tokenEnv: config.tokenEnv ?? DEFAULT_TOKEN_ENV,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    hintLimit: config.hintLimit ?? DEFAULT_HINT_LIMIT,
    discovery: {
      maxQueries: config.discovery?.maxQueries ?? DEFAULT_DISCOVERY_BUDGETS.maxQueries,
      searchPerPage: config.discovery?.searchPerPage ?? DEFAULT_DISCOVERY_BUDGETS.searchPerPage,
      searchMaxPages: config.discovery?.searchMaxPages ?? DEFAULT_DISCOVERY_BUDGETS.searchMaxPages,
      maxCandidateFiles: config.discovery?.maxCandidateFiles ?? DEFAULT_DISCOVERY_BUDGETS.maxCandidateFiles,
      maxDiscoveredPaths: config.discovery?.maxDiscoveredPaths ?? DEFAULT_DISCOVERY_BUDGETS.maxDiscoveredPaths,
    },
    read: {
      maxFiles: config.read?.maxFiles ?? DEFAULT_READ_BUDGETS.maxFiles,
      maxFileChars: config.read?.maxFileChars ?? DEFAULT_READ_BUDGETS.maxFileChars,
      maxTotalChars: config.read?.maxTotalChars ?? DEFAULT_READ_BUDGETS.maxTotalChars,
      readConcurrency: config.read?.readConcurrency ?? DEFAULT_READ_BUDGETS.readConcurrency,
    },
  }
}

/** Trim, de-duplicate, and cap a schema-validated hint array. */
function readHintArray(values: string[] | undefined, limit: number): string[] {
  return [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))].slice(0, limit)
}

/** Per-file analysis entry schema shared between `files` and the aggregate lists. */
const STRING_ARRAY = { type: 'array', items: { type: 'string' } } as const

/**
 * Register the `intranet_gitlab_analyze_code_source` tool.
 * @param ctx - registrant context carrying the tool registry.
 * @param rawConfig - deployment's GitLab endpoint references and budgets.
 */
export function apply(ctx: Context, rawConfig: Config): void {
  const config = resolveConfig(rawConfig)

  ctx.tools.register(defineTool({
    name: 'intranet_gitlab_analyze_code_source',
    description:
      'Resolve an intranet GitLab project, use requirement clues to discover and verify relevant '
      + 'code when needed, compare it with user paths, then read and analyze the bounded effective scope.',
    parameters: {
      projectLocator: {
        type: 'string',
        required: true,
        description: 'GitLab project identifier: numeric ID, final project name, full namespace path, or intranet GitLab project URL',
      },
      ref: {
        type: 'string',
        description: 'Branch, tag, or commit SHA; defaults to the project default branch',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'File or directory paths to read and analyze',
      },
      moduleHints: {
        type: 'array',
        items: { type: 'string' },
        description: "Module, page, or business names extracted from the user's exact wording and requirement wiki",
      },
      routeHints: { type: 'array', items: { type: 'string' }, description: 'Known URL or route fragments' },
      apiHints: { type: 'array', items: { type: 'string' }, description: 'Known API paths, events, or service names' },
      uiTexts: { type: 'array', items: { type: 'string' }, description: 'Distinctive UI text, button, field, dialog, or menu labels' },
      changeDescription: {
        type: 'string',
        description: 'Short normalized change description; do not pass the full requirement wiki body',
      },
      projectType: {
        type: 'string',
        enum: ['auto', 'node', 'vue', 'react', 'qt'],
        description: 'Optional project type hint',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              projectId: { type: 'string', required: true },
              projectName: { type: 'string', required: true },
              projectPath: { type: 'string', required: true },
              defaultBranch: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              ref: { type: 'string', required: true, description: 'The ref the analysis ran against.' },
            },
          },
          discovery: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              guidanceFiles: { ...STRING_ARRAY, required: true },
              status: { type: 'string', required: true, enum: ['confirmed', 'candidate', 'unresolved'] },
              evidence: { ...STRING_ARRAY, required: true },
              discoveredPaths: { ...STRING_ARRAY, required: true },
              effectivePaths: { ...STRING_ARRAY, required: true },
              comparison: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  overlap: { ...STRING_ARRAY, required: true },
                  userOnly: { ...STRING_ARRAY, required: true },
                  autoSupplement: { ...STRING_ARRAY, required: true },
                },
              },
              warnings: { ...STRING_ARRAY, required: true },
              truncated: { type: 'boolean', required: true },
            },
          },
          analysis: {
            required: true,
            description: 'Null when discovery produced no verifiable scope; content analysis is then skipped.',
            oneOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  source: {
                    type: 'object',
                    required: true,
                    additionalProperties: false,
                    properties: {
                      projectId: { type: 'string', required: true },
                      projectName: { type: 'string', required: true },
                      projectPath: { type: 'string', required: true },
                      ref: { type: 'string', required: true },
                      paths: { ...STRING_ARRAY, required: true },
                      projectType: { type: 'string', required: true, enum: ['auto', 'node', 'vue', 'react', 'qt'] },
                    },
                  },
                  fileCount: { type: 'integer', required: true },
                  files: {
                    type: 'array',
                    required: true,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        path: { type: 'string', required: true },
                        language: { type: 'string', required: true },
                        size: { type: 'integer', required: true },
                        imports: { ...STRING_ARRAY, required: true },
                        exports: { ...STRING_ARRAY, required: true },
                        symbols: { ...STRING_ARRAY, required: true },
                        apiCalls: { ...STRING_ARRAY, required: true },
                        routes: { ...STRING_ARRAY, required: true },
                      },
                    },
                  },
                  apiCalls: { ...STRING_ARRAY, required: true },
                  routes: { ...STRING_ARRAY, required: true },
                  components: { ...STRING_ARRAY, required: true },
                  services: { ...STRING_ARRAY, required: true },
                  dtos: { ...STRING_ARRAY, required: true },
                  dependencies: { ...STRING_ARRAY, required: true },
                  sideEffects: { ...STRING_ARRAY, required: true },
                },
              },
            ],
          },
          warnings: { ...STRING_ARRAY, required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const locator = args.projectLocator.trim()
      if (locator.length === 0) {
        throw new Error("'projectLocator' is required and must be a string")
      }
      const ref = args.ref?.trim() ?? ''
      const paths = (args.paths ?? []).map(p => p.trim()).filter(Boolean)
      const moduleHints = readHintArray(args.moduleHints, config.hintLimit)
      const routeHints = readHintArray(args.routeHints, config.hintLimit)
      const apiHints = readHintArray(args.apiHints, config.hintLimit)
      const uiTexts = readHintArray(args.uiTexts, config.hintLimit)
      const changeDescription = args.changeDescription?.trim() ?? ''
      if (
        paths.length === 0 && moduleHints.length === 0 && routeHints.length === 0
        && apiHints.length === 0 && uiTexts.length === 0 && changeDescription === ''
      ) {
        throw new Error('Provide at least one code path or requirement clue for code discovery')
      }

      const endpoint = await resolveGitlabEndpoint(ctx, config)
      const client = new IntranetGitlabClient(endpoint)
      const project = await resolveGitlabProject(client, locator, exec.signal)
      const effectiveRef = ref !== '' ? ref : project.defaultBranch
      if (effectiveRef === null) {
        throw new Error("'ref' was omitted and the GitLab project has no default branch")
      }
      const discoverer = new CodeScopeDiscoverer(client, config.discovery)
      const discovery = await discoverer.discover({
        projectId: project.projectId,
        ref: effectiveRef,
        userPaths: paths,
        moduleHints,
        routeHints,
        apiHints,
        uiTexts,
        changeDescription,
        signal: exec.signal,
      })
      const projectOut = { ...project, ref: effectiveRef }
      if (discovery.effectivePaths.length === 0) {
        return {
          project: projectOut,
          discovery,
          analysis: null,
          warnings: [...discovery.warnings, 'No verifiable code scope was formed; content analysis was skipped'],
          truncated: discovery.truncated,
        }
      }
      const reader = new CodeSourceReader(client, config.read)
      const source = {
        projectId: project.projectId,
        projectName: project.projectName,
        projectPath: project.projectPath,
        ref: effectiveRef,
        paths: discovery.effectivePaths,
        projectType: args.projectType ?? 'auto',
        signal: exec.signal,
      }
      const readResult = await reader.read(source)
      const analysis = analyzeCodeSource(source, readResult.files)

      return {
        project: projectOut,
        discovery,
        analysis,
        warnings: [...discovery.warnings, ...readResult.warnings],
        truncated: discovery.truncated || readResult.truncated,
      }
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'search',
      title: `Analyze intranet GitLab code: ${args.projectLocator}`,
      rawInput: args,
    }),
  }))
}
