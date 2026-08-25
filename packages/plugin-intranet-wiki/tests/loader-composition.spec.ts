// Proves the shipping Loader composition: the plugin is mounted from a
// cordis.yml through the real Loader, `applyWriteApproval` is genuine
// load-time configurability, and the ask policy fails closed without an
// approval seam while `allow` completes a real write against the HTTP stub.
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
import * as ToolWiki from '@hydra-dsh/plugin-intranet-wiki'
import { StubWikiServer } from './stub-wiki-server.ts'

const BASE_ENV = 'TEST_INTRANET_WIKI_LOADER_BASE_URL'
const TOKEN_ENV = 'TEST_INTRANET_WIKI_LOADER_TOKEN'

let server: StubWikiServer
let root: string | undefined
let context: Context | undefined

beforeAll(async () => {
  server = new StubWikiServer()
  await server.listen()
  process.env[BASE_ENV] = server.baseUrl
  process.env[TOKEN_ENV] = 'loader-token'
})

afterAll(async () => {
  delete process.env.TEST_INTRANET_WIKI_LOADER_BASE_URL
  delete process.env.TEST_INTRANET_WIKI_LOADER_TOKEN
  await server.close()
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  server.writes.length = 0
})

/**
 * Boot a cordis.yml carrying the given tool config block through the Loader.
 * @param configLines - YAML lines nested under the tool's `config:` key.
 * @returns the booted context.
 */
async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-intranet-wiki-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@hydra-dsh/plugin-intranet-wiki'",
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
    ['@hydra-dsh/plugin-intranet-wiki', ToolWiki],
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
function callTool(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`loader-call-${++callCounter}`),
    name,
    arguments: args,
  })
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const REF_LINES = [
  `    baseUrlEnv: ${BASE_ENV}`,
  `    tokenEnv: ${TOKEN_ENV}`,
]

describe('intranet-tool-wiki real Loader composition through cordis.yml', () => {
  it('fails loading when applyWriteApproval is omitted', async () => {
    await expect(boot(REF_LINES)).rejects.toThrow(/applyWriteApproval/)
  }, 30_000)

  it('fails loading when applyWriteApproval is outside the union', async () => {
    await expect(boot([...REF_LINES, '    applyWriteApproval: sometimes'])).rejects.toThrow(/applyWriteApproval/)
  }, 30_000)

  it('ask: the write tool fails closed without an approval seam and touches nothing', async () => {
    const ctx = await boot([...REF_LINES, '    applyWriteApproval: ask'])
    const result = await callTool(ctx, 'intranet_wiki_apply_write', {
      action: 'append_page',
      pageId: '31',
      contentMarkdown: 'body',
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('This call writes to the intranet wiki.')
    expect(server.writes).toHaveLength(0)
  }, 30_000)

  it('allow: the composed plugin completes a real create_child against the stub', async () => {
    server.addPage({ id: '9', title: 'Parent', version: 1, spaceKey: 'SP', storageHtml: '<p>p</p>' })
    const ctx = await boot([...REF_LINES, '    applyWriteApproval: allow'])
    const result = await callTool(ctx, 'intranet_wiki_apply_write', {
      action: 'create_child',
      parentPageId: '9',
      title: 'From Loader',
      contentMarkdown: '# Plan',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toMatchObject({ status: 'written', pageId: 'created-1' })
    expect(server.writes[0]?.method).toBe('POST')
  }, 30_000)

  it('fails at the call with remediation when the credential references are unset', async () => {
    const ctx = await boot([
      '    baseUrlEnv: TEST_INTRANET_WIKI_LOADER_MISSING_BASE',
      '    tokenEnv: TEST_INTRANET_WIKI_LOADER_MISSING_TOKEN',
      '    applyWriteApproval: allow',
    ])
    const result = await callTool(ctx, 'intranet_wiki_read_page', { pageId: '1' })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('unconfigured')
    expect(resultText(result)).toContain('TEST_INTRANET_WIKI_LOADER_MISSING_BASE')
  }, 30_000)
})
