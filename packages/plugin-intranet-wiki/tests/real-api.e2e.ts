// Real-API smoke against the company wiki. Self-skips without the intranet
// credentials so keyless CI and off-VPN machines stay green; the write path
// additionally requires an explicit sandbox parent page.
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as tool from '../src/index.ts'

const BASE_ENV = 'INTRANET_WIKI_BASE_URL'
const TOKEN_ENV = 'INTRANET_WIKI_TOKEN'
const READ_PAGE_ENV = 'INTRANET_WIKI_E2E_PAGE_ID'
const WRITE_PARENT_ENV = 'INTRANET_WIKI_E2E_PARENT_PAGE'

const hasReadTarget = process.env[BASE_ENV] !== undefined
  && process.env[TOKEN_ENV] !== undefined
  && process.env[READ_PAGE_ENV] !== undefined
const writeParent = process.env[WRITE_PARENT_ENV]

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

async function setup(): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, { applyWriteApproval: 'allow' })
  return ctx
}

let callCounter = 0
function callTool(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`wiki-e2e-${++callCounter}`),
    name,
    arguments: args,
  })
}

describe.skipIf(!hasReadTarget)('intranet wiki real-API', () => {
  it('reads the configured page and prepares an append plan against it', async () => {
    const ctx = await setup()
    const pageId = process.env[READ_PAGE_ENV]
    const read = await callTool(ctx, 'intranet_wiki_read_page', { pageId, maxChars: 2000 })
    expect(read.isError).toBe(false)
    if (read.isError) throw new Error('expected read success')
    const readValue = read.value as { pages: { pageId: string; title?: string }[]; completeness: string }
    expect(readValue.pages[0]?.pageId).toBeTruthy()

    const plan = await callTool(ctx, 'intranet_wiki_prepare_write', {
      action: 'append_page',
      pageId,
      contentMarkdown: 'e2e prepare-only probe',
    })
    expect(plan.isError).toBe(false)
    if (plan.isError) throw new Error('expected prepare success')
    expect((plan.value as { target: { pageId: string } }).target.pageId).toBeTruthy()
  }, 60_000)

  it.skipIf(writeParent === undefined)('creates a child page under the sandbox parent', async () => {
    const ctx = await setup()
    const result = await callTool(ctx, 'intranet_wiki_apply_write', {
      action: 'create_child',
      parentPageId: writeParent,
      title: `dsh e2e ${Date.now()}`,
      contentMarkdown: '# dsh intranet wiki e2e\n\nAutomated smoke write; safe to delete.',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected write success')
    const value = result.value as { status: string; pageId: string; url?: string }
    expect(value.status).toBe('written')
    // Verify the world, not the self-report: read the created page back.
    const verify = await callTool(ctx, 'intranet_wiki_read_page', { pageId: value.pageId })
    expect(verify.isError).toBe(false)
    if (verify.isError) throw new Error('expected verification read success')
    expect((verify.value as { pages: { text?: string }[] }).pages[0]?.text).toContain('Automated smoke write')
  }, 120_000)
})
