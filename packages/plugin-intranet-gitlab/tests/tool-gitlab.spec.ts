// Drives the REAL plugin body: mounts dsh-intranet-tool-gitlab on a real
// ToolRuntime and calls the registered tool through ctx.tools.execute against
// a real loopback HTTP stub, so only the remote GitLab endpoint is a stand-in.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as tool from '../src/index.ts'
import { StubGitlabServer } from './stub-gitlab-server.ts'

const BASE_ENV = 'TEST_INTRANET_GITLAB_BASE_URL'
const TOKEN_ENV = 'TEST_INTRANET_GITLAB_TOKEN'
const TOOL = 'intranet_gitlab_analyze_code_source'

let server: StubGitlabServer

beforeAll(async () => {
  server = new StubGitlabServer()
  await server.listen()
  process.env[BASE_ENV] = `${server.baseUrl}/`
  process.env[TOKEN_ENV] = 'test-token'
})

afterAll(async () => {
  delete process.env.TEST_INTRANET_GITLAB_BASE_URL
  delete process.env.TEST_INTRANET_GITLAB_TOKEN
  await server.close()
})

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  server.repo.files.clear()
  server.repo.blobMatches.clear()
  server.responseDelayMs = 0
})

async function setup(config: Partial<tool.Config> = {}): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, {
    baseUrlEnv: BASE_ENV,
    tokenEnv: TOKEN_ENV,
    ...config,
  })
  return ctx
}

let callCounter = 0
function call(ctx: Context, args: unknown, signal = new AbortController().signal) {
  return ctx.tools.execute({
    signal,
    callId: CallId(`gitlab-call-${++callCounter}`),
    name: TOOL,
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const PROJECT = { id: 42, name: 'Heads H5', path: 'heads-h5', path_with_namespace: 'ficc/heads-h5', default_branch: 'main' }

describe('registration', () => {
  it('registers the tool with its declared schema and concurrency profile', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === TOOL)
    expect(schema).toBeDefined()
    const props = (schema?.parameters as { properties?: Record<string, unknown>; required?: string[] })
    expect(props.required).toEqual(['projectLocator'])
    expect(Object.keys(props.properties ?? {})).toContain('moduleHints')
    expect(Object.keys(props.properties ?? {})).not.toContain('projectId')
    expect(ctx.tools.get(TOOL)?.isConcurrencySafe?.({ projectLocator: '42' })).toBe(true)
    expect(ctx.tools.get(TOOL)?.timeoutMs).toBe(60000)
  })

  it('applies the module defaults when mounted below the schema layer', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    tool.apply(ctx, {})
    expect(ctx.tools.get(TOOL)?.timeoutMs).toBe(60000)
  })

  it('unregisters on fiber dispose (HMR safety)', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(tool, { baseUrlEnv: BASE_ENV, tokenEnv: TOKEN_ENV })
    expect(ctx.tools.schemas().some(s => s.name === TOOL)).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === TOOL)).toBe(false)
  })
})

describe('validation', () => {
  it('rejects a call with neither paths nor clues', async () => {
    const ctx = await setup()
    const result = await call(ctx, { projectLocator: '42', ref: 'main', paths: [] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('at least one code path or requirement clue')
  })

  it('rejects a blank locator', async () => {
    const ctx = await setup()
    const result = await call(ctx, { projectLocator: '   ', paths: ['src/a.ts'] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain("'projectLocator' is required")
  })

  it('fails with remediation when the credential references are unset', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(tool, {
      baseUrlEnv: 'TEST_INTRANET_GITLAB_UNSET_BASE',
      tokenEnv: 'TEST_INTRANET_GITLAB_UNSET_TOKEN',
    })
    const result = await call(ctx, { projectLocator: '42', paths: ['src/a.ts'] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unconfigured')
    expect(text(result)).toContain('TEST_INTRANET_GITLAB_UNSET_BASE')
  })
})

describe('analysis', () => {
  it('resolves the project, reads the user path, and returns the canonical analysis', async () => {
    const ctx = await setup()
    server.addProject(PROJECT)
    server.repo.files.set('src/main.ts', "export const HeadsPage = () => fetch('/api/heads')")
    const result = await call(ctx, { projectLocator: '42', ref: 'main', paths: ['src/main.ts'] })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as {
      project: Record<string, unknown>
      discovery: { status: string; effectivePaths: string[] }
      analysis: { source: Record<string, unknown>; fileCount: number; apiCalls: string[] } | null
      truncated: boolean
    }
    expect(value.project).toEqual({
      projectId: '42',
      projectName: 'heads-h5',
      projectPath: 'ficc/heads-h5',
      defaultBranch: 'main',
      ref: 'main',
    })
    expect(value.analysis?.source).toEqual({
      projectId: '42',
      projectName: 'heads-h5',
      projectPath: 'ficc/heads-h5',
      ref: 'main',
      paths: ['src/main.ts'],
      projectType: 'auto',
    })
    expect(value.analysis?.fileCount).toBe(1)
    expect(value.analysis?.apiCalls).toEqual(['/api/heads'])
    expect(text(result)).toContain('"projectPath": "ficc/heads-h5"')
  })

  it('falls back to the default branch and errors when the project has none', async () => {
    const ctx = await setup()
    server.addProject(PROJECT)
    server.repo.files.set('src/a.ts', 'export {}')
    const viaDefault = await call(ctx, { projectLocator: 'ficc/heads-h5', paths: ['src/a.ts'] })
    expect(viaDefault.isError).toBe(false)
    if (viaDefault.isError) throw new Error('expected success')
    expect((viaDefault.value as { project: { ref: string } }).project.ref).toBe('main')

    server.addProject({ id: 7, name: 'Bare', path: 'bare', path_with_namespace: 'ficc/bare' })
    const noBranch = await call(ctx, { projectLocator: '7', paths: ['src/a.ts'] })
    expect(noBranch.isError).toBe(true)
    expect(text(noBranch)).toContain('no default branch')
  })

  it('skips content analysis with a warning when no verifiable scope forms', async () => {
    const ctx = await setup()
    server.addProject(PROJECT)
    const result = await call(ctx, { projectLocator: '42', moduleHints: ['heads'] })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { analysis: unknown; discovery: { status: string }; warnings: string[] }
    expect(value.analysis).toBeNull()
    expect(value.discovery.status).toBe('unresolved')
    expect(value.warnings.at(-1)).toContain('content analysis was skipped')
  })

  it('discovers scope from hints when no user paths are given', async () => {
    const ctx = await setup()
    server.addProject(PROJECT)
    server.repo.files.set('src/router.ts', "path: '/heads'\nimport('./views/HeadsPage.vue')\nheads")
    server.repo.files.set('src/views/HeadsPage.vue', '<template>heads</template>')
    server.repo.blobMatches.set('heads', ['src/router.ts'])
    const result = await call(ctx, { projectLocator: '42', moduleHints: ['heads'] })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as {
      discovery: { status: string; effectivePaths: string[] }
      analysis: { fileCount: number } | null
    }
    expect(value.discovery.status).toBe('confirmed')
    expect(value.discovery.effectivePaths).toEqual(['src/router.ts', 'src/views/HeadsPage.vue'])
    expect(value.analysis?.fileCount).toBe(2)
  })

  it('surfaces GitLab failures as tool errors', async () => {
    const ctx = await setup()
    const result = await call(ctx, { projectLocator: '404404', paths: ['src/a.ts'] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('No exact GitLab project path')
  })

  it('honors exec.signal cancellation mid-call', async () => {
    const ctx = await setup()
    server.addProject(PROJECT)
    server.responseDelayMs = 5000
    const controller = new AbortController()
    const pending = call(ctx, { projectLocator: '42', paths: ['src/a.ts'] }, controller.signal)
    setTimeout(() => {
      controller.abort()
    }, 50)
    const result = await pending
    expect(result.isError).toBe(true)
  }, 10_000)
})

describe('presentation', () => {
  it('presents calls as a generic search card naming the locator', async () => {
    const ctx = await setup()
    expect(ctx.tools.get(TOOL)?.presentCall?.({ projectLocator: 'ficc/heads-h5', moduleHints: ['x'] })).toMatchObject({
      card: 'generic',
      kind: 'search',
      title: 'Analyze intranet GitLab code: ficc/heads-h5',
    })
  })
})
