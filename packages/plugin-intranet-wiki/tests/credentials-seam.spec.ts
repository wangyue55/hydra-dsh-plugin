// Proves the tools resolve their endpoint through the credentials seam when a
// provider is composed: the same env-named references route through
// `ctx.credentials` instead of the launch-environment fallback.
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
import { StubWikiServer } from './stub-wiki-server.ts'

const BASE_ENV = 'TEST_INTRANET_WIKI_SEAM_BASE_URL'
const TOKEN_ENV = 'TEST_INTRANET_WIKI_SEAM_TOKEN'

let server: StubWikiServer
let home: string
let context: Context | undefined

beforeAll(async () => {
  server = new StubWikiServer()
  await server.listen()
  home = await mkdtemp(join(tmpdir(), 'dsh-intranet-wiki-creds-'))
})

afterAll(async () => {
  delete process.env.TEST_INTRANET_WIKI_SEAM_BASE_URL
  delete process.env.TEST_INTRANET_WIKI_SEAM_TOKEN
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
  await ctx.plugin(tool, {
    baseUrlEnv: BASE_ENV,
    tokenEnv: TOKEN_ENV,
    applyWriteApproval: 'allow',
  })
  return ctx
}

let callCounter = 0
function readPage(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`seam-call-${++callCounter}`),
    name: 'intranet_wiki_read_page',
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
    server.addPage({ id: 's1', title: 'SeamPage', storageHtml: '<p>via seam</p>' })
    const result = await readPage(ctx, { pageId: 's1' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect((result.value as { pages: { text?: string }[] }).pages[0]?.text).toBe('via seam')
  })

  it('treats an unresolvable reference as unconfigured with remediation', async () => {
    delete process.env.TEST_INTRANET_WIKI_SEAM_BASE_URL
    process.env[TOKEN_ENV] = 'seam-token'
    const ctx = await setup()
    const result = await readPage(ctx, { pageId: 's1' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unconfigured')
    expect(text(result)).toContain(BASE_ENV)
  })

  it('treats an empty resolved value as unconfigured', async () => {
    process.env[BASE_ENV] = server.baseUrl
    process.env[TOKEN_ENV] = ''
    const ctx = await setup()
    const result = await readPage(ctx, { pageId: 's1' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(TOKEN_ENV)
  })
})
