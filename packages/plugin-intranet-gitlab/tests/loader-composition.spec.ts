// Proves the shipping Loader composition: the plugin is mounted from a
// cordis.yml through the real Loader, budgets are genuine load-time
// configurability, and a composed call completes a real analysis against the
// HTTP stub.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolGitlab from '@hydra-dsh/plugin-intranet-gitlab'
import { StubGitlabServer } from './stub-gitlab-server.ts'

const BASE_ENV = 'TEST_INTRANET_GITLAB_LOADER_BASE_URL'
const TOKEN_ENV = 'TEST_INTRANET_GITLAB_LOADER_TOKEN'

let server: StubGitlabServer
let root: string | undefined
let context: Context | undefined

beforeAll(async () => {
  server = new StubGitlabServer()
  await server.listen()
  process.env[BASE_ENV] = server.baseUrl
  process.env[TOKEN_ENV] = 'loader-token'
})

afterAll(async () => {
  delete process.env.TEST_INTRANET_GITLAB_LOADER_BASE_URL
  delete process.env.TEST_INTRANET_GITLAB_LOADER_TOKEN
  await server.close()
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot a cordis.yml carrying the given tool config block through the Loader.
 * @param configLines - YAML lines nested under the tool's `config:` key.
 * @returns the booted context.
 */
async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-intranet-gitlab-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@hydra-dsh/plugin-intranet-gitlab'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@hydra-dsh/plugin-intranet-gitlab', ToolGitlab],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

let callCounter = 0
function callTool(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`gitlab-loader-${++callCounter}`),
    name: 'intranet_gitlab_analyze_code_source',
    arguments: args,
  })
}

const REF_LINES = [
  `    baseUrlEnv: ${BASE_ENV}`,
  `    tokenEnv: ${TOKEN_ENV}`,
]

describe('intranet-tool-gitlab real Loader composition through cordis.yml', () => {
  it('fails loading when a budget is outside its schema bounds', async () => {
    await expect(boot([...REF_LINES, '    read:', '      maxFiles: 0'])).rejects.toThrow(/maxFiles/)
  }, 30_000)

  it('mounts with defaults only and completes a real analysis against the stub', async () => {
    server.addProject({ id: 42, name: 'H', path: 'heads-h5', path_with_namespace: 'ficc/heads-h5', default_branch: 'main' })
    server.repo.files.set('src/main.ts', "export const x = () => fetch('/api/heads')")
    const ctx = await boot(REF_LINES)
    const result = await callTool(ctx, { projectLocator: '42', paths: ['src/main.ts'] })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toMatchObject({
      project: { projectId: '42', ref: 'main' },
      analysis: { fileCount: 1 },
    })
  }, 30_000)

  it('applies a configured read budget end to end', async () => {
    server.addProject({ id: 42, name: 'H', path: 'heads-h5', path_with_namespace: 'ficc/heads-h5', default_branch: 'main' })
    server.repo.files.set('src/a.ts', 'export {}')
    server.repo.files.set('src/b.ts', 'export {}')
    const ctx = await boot([...REF_LINES, '    read:', '      maxFiles: 1'])
    const result = await callTool(ctx, { projectLocator: '42', paths: ['src/a.ts', 'src/b.ts'] })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { analysis: { fileCount: number } | null; truncated: boolean }
    expect(value.analysis?.fileCount).toBe(1)
    expect(value.truncated).toBe(true)
  }, 30_000)
})
