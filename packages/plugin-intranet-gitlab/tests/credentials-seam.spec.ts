// Proves the tool resolves its endpoint through the credentials seam when a
// provider is composed, and treats empty or missing references as unconfigured.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import * as tool from '../src/index.ts'
import { StubGitlabServer } from './stub-gitlab-server.ts'

const BASE_ENV = 'TEST_INTRANET_GITLAB_SEAM_BASE_URL'
const TOKEN_ENV = 'TEST_INTRANET_GITLAB_SEAM_TOKEN'

let server: StubGitlabServer
let home: string
let context: Context | undefined

beforeAll(async () => {
  server = new StubGitlabServer()
  await server.listen()
  home = await mkdtemp(join(tmpdir(), 'dsh-intranet-gitlab-creds-'))
})

afterAll(async () => {
  delete process.env.TEST_INTRANET_GITLAB_SEAM_BASE_URL
  delete process.env.TEST_INTRANET_GITLAB_SEAM_TOKEN
  await server.close()
  await rm(home, { recursive: true, force: true })
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

async function setup(): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalCredentialProvider, { dshHome: home, watch: false })
  await ctx.plugin(tool, { baseUrlEnv: BASE_ENV, tokenEnv: TOKEN_ENV })
  return ctx
}

let callCounter = 0
function analyze(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`gitlab-seam-${++callCounter}`),
    name: 'intranet_gitlab_analyze_code_source',
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('credentials-seam resolution', () => {
  it('resolves the endpoint through ctx.credentials when the seam is composed', async () => {
    process.env[BASE_ENV] = server.baseUrl
    process.env[TOKEN_ENV] = 'seam-token'
    const ctx = await setup()
    expect(ctx.get('credentials')).toBeDefined()
    server.addProject({ id: 9, name: 'S', path: 'seam', path_with_namespace: 'g/seam', default_branch: 'main' })
    server.repo.files.set('src/a.ts', 'export {}')
    const result = await analyze(ctx, { projectLocator: '9', paths: ['src/a.ts'] })
    expect(result.isError).toBe(false)
  })

  it('treats an empty resolved value as unconfigured', async () => {
    process.env[BASE_ENV] = server.baseUrl
    process.env[TOKEN_ENV] = ''
    const ctx = await setup()
    const result = await analyze(ctx, { projectLocator: '9', paths: ['src/a.ts'] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(TOKEN_ENV)
  })

  it('treats a missing reference as unconfigured with remediation', async () => {
    delete process.env.TEST_INTRANET_GITLAB_SEAM_BASE_URL
    process.env[TOKEN_ENV] = 'seam-token'
    const ctx = await setup()
    const result = await analyze(ctx, { projectLocator: '9', paths: ['src/a.ts'] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unconfigured')
    expect(text(result)).toContain(BASE_ENV)
  })
})
