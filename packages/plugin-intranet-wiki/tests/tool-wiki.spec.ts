// Drives the REAL plugin body: mounts dsh-intranet-tool-wiki on a real
// ToolRuntime and calls the registered tools through ctx.tools.execute against
// a real loopback HTTP stub, so only the remote wiki endpoint is a stand-in.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as tool from '../src/index.ts'
import { StubWikiServer } from './stub-wiki-server.ts'

const BASE_ENV = 'TEST_INTRANET_WIKI_BASE_URL'
const TOKEN_ENV = 'TEST_INTRANET_WIKI_TOKEN'

let server: StubWikiServer

beforeAll(async () => {
  server = new StubWikiServer()
  await server.listen()
  process.env[BASE_ENV] = `${server.baseUrl}/`
  process.env[TOKEN_ENV] = 'test-token'
})

afterAll(async () => {
  delete process.env.TEST_INTRANET_WIKI_BASE_URL
  delete process.env.TEST_INTRANET_WIKI_TOKEN
  await server.close()
})

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  server.writes.length = 0
  server.responseDelayMs = 0
  server.failure = undefined
  server.failBodyIds = []
  server.blankWriteResponse = false
  server.bodyDelayMs = 0
})

async function setup(config: Partial<tool.Config> = {}): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, {
    baseUrlEnv: BASE_ENV,
    tokenEnv: TOKEN_ENV,
    applyWriteApproval: 'allow',
    ...config,
  })
  return ctx
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown, signal = new AbortController().signal) {
  return ctx.tools.execute({
    signal,
    callId: CallId(`wiki-call-${++callCounter}`),
    name,
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('tool registration', () => {
  it('registers the three wiki tools with their declared schemas', async () => {
    const ctx = await setup()
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('intranet_wiki_read_page')
    expect(names).toContain('intranet_wiki_prepare_write')
    expect(names).toContain('intranet_wiki_apply_write')
    const read = ctx.tools.schemas().find(schema => schema.name === 'intranet_wiki_read_page')
    const props = (read?.parameters as { properties?: Record<string, { enum?: string[]; description?: string }> }).properties ?? {}
    expect(props.scope?.enum).toEqual(['current', 'descendants'])
    expect(props.maxChars?.description).toContain('default 60000')
  })

  it('applies the module defaults when mounted below the schema layer', async () => {
    // Direct body call: cordis-mounted plugins receive schema-filled config,
    // so only this path exercises the explicit resolve step's defaults.
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    tool.apply(ctx, { applyWriteApproval: 'allow' })
    const read = ctx.tools.get('intranet_wiki_read_page')
    expect(read?.timeoutMs).toBe(60000)
    expect(ctx.tools.get('intranet_wiki_apply_write')?.timeoutMs).toBe(30000)
    const schema = ctx.tools.schemas().find(s => s.name === 'intranet_wiki_read_page')
    const props = (schema?.parameters as { properties?: Record<string, { description?: string }> }).properties ?? {}
    expect(props.maxPages?.description).toContain('default 30 and maximum 100')
  })

  it('unregisters the tools when the plugin fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(tool, {
      baseUrlEnv: BASE_ENV,
      tokenEnv: TOKEN_ENV,
      applyWriteApproval: 'ask',
    })
    expect(ctx.tools.schemas().some(schema => schema.name === 'intranet_wiki_read_page')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name.startsWith('intranet_wiki'))).toBe(false)
  })
})

describe('intranet_wiki_read_page', () => {
  it('reads one page in current scope as the canonical single-entry tree', async () => {
    const ctx = await setup()
    server.addPage({ id: '123', title: 'Root', version: 3, storageHtml: '<p>Hello</p>' })
    const result = await call(ctx, 'intranet_wiki_read_page', { pageId: '123' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toEqual({
      scope: 'current',
      rootPageId: '123',
      discoveredCount: 1,
      fetchedCount: 1,
      failedCount: 0,
      treeTruncated: false,
      contentTruncated: false,
      completeness: 'complete',
      pages: [{
        pageId: '123',
        depth: 0,
        title: 'Root',
        url: `${server.baseUrl}/pages/viewpage.action?pageId=123`,
        version: 3,
        text: 'Hello',
        truncated: false,
      }],
      warnings: [],
    })
    expect(text(result)).toContain('"completeness": "complete"')
  })

  it('accepts a URL carrying the pageId and reports that URL back', async () => {
    const ctx = await setup()
    server.addPage({ id: '77', title: 'ByUrl', storageHtml: '<p>u</p>' })
    const url = `${server.baseUrl}/pages/viewpage.action?pageId=77`
    const result = await call(ctx, 'intranet_wiki_read_page', { url })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const page = (result.value as { pages: { url?: string; version?: number }[] }).pages[0]
    expect(page?.url).toBe(url)
    expect(page?.version).toBeUndefined()
  })

  it('rejects a call naming neither url nor pageId', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'intranet_wiki_read_page', {})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain("Either 'url' or 'pageId' is required")
  })

  it('rejects descendants scope without a resolvable pageId', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'intranet_wiki_read_page', { url: `${server.baseUrl}/display/X`, scope: 'descendants' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('descendants scope requires')
  })

  it('truncates the current page at the clamped maxChars budget', async () => {
    const ctx = await setup()
    server.addPage({ id: 'big', title: 'Big', storageHtml: `<p>${'a'.repeat(50)}</p>` })
    const result = await call(ctx, 'intranet_wiki_read_page', { pageId: 'big', maxChars: 10 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { contentTruncated: boolean; completeness: string; pages: { text?: string }[]; warnings: string[] }
    expect(value.contentTruncated).toBe(true)
    expect(value.completeness).toBe('partial_content')
    expect(value.pages[0]?.text).toBe('a'.repeat(10))
    expect(value.warnings[0]).toContain('exceeds 10 characters')
  })

  it('keeps an exact-budget body untruncated (boundary case)', async () => {
    const ctx = await setup()
    server.addPage({ id: 'exact', title: 'Exact', storageHtml: `<p>${'b'.repeat(10)}</p>` })
    const result = await call(ctx, 'intranet_wiki_read_page', { pageId: 'exact', maxChars: 10 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect((result.value as { contentTruncated: boolean }).contentTruncated).toBe(false)
  })

  it('walks descendants breadth-first and reads every page body', async () => {
    const ctx = await setup()
    server.addPage({ id: '123', title: 'Root', version: 1, storageHtml: '<p>Body 123</p>', childIds: ['124'] })
    server.addPage({ id: '124', title: 'Child', version: 2, storageHtml: '<p>Body 124</p>' })
    const result = await call(ctx, 'intranet_wiki_read_page', {
      pageId: '123',
      scope: 'descendants',
      maxDepth: 2,
      maxPages: 10,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as {
      scope: string
      completeness: string
      discoveredCount: number
      pages: { pageId: string; text?: string; parentPageId?: string; depth: number }[]
    }
    expect(value.scope).toBe('descendants')
    expect(value.completeness).toBe('complete')
    expect(value.discoveredCount).toBe(2)
    expect(value.pages.map(page => page.pageId)).toEqual(['123', '124'])
    expect(value.pages.map(page => page.text)).toEqual(['Body 123', 'Body 124'])
    expect(value.pages[1]?.parentPageId).toBe('123')
    expect(value.pages[1]?.depth).toBe(1)
  })

  it('omits the url and version fields for a page served without either', async () => {
    const ctx = await setup()
    server.addPage({ id: 'bare', title: 'Bare', storageHtml: '<p>b</p>', noLink: true })
    const result = await call(ctx, 'intranet_wiki_read_page', { pageId: 'bare' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect((result.value as { pages: Record<string, unknown>[] }).pages[0]).toEqual({
      pageId: 'bare',
      depth: 0,
      title: 'Bare',
      text: 'b',
      truncated: false,
    })
  })

  it('reports partial_tree when descendants exist beyond the depth budget', async () => {
    const ctx = await setup()
    server.addPage({ id: 'r3', title: 'R3', storageHtml: '<p>r</p>', childIds: ['c3'] })
    server.addPage({ id: 'c3', title: 'C3', storageHtml: '<p>c</p>', childIds: ['g3'] })
    server.addPage({ id: 'g3', title: 'G3', storageHtml: '<p>g</p>' })
    const result = await call(ctx, 'intranet_wiki_read_page', { pageId: 'r3', scope: 'descendants', maxDepth: 1 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { completeness: string; treeTruncated: boolean; pages: { pageId: string }[] }
    expect(value.treeTruncated).toBe(true)
    expect(value.completeness).toBe('partial_tree')
    expect(value.pages.map(page => page.pageId)).toEqual(['r3', 'c3'])
  })

  it('records a failing root body read with no parent field', async () => {
    const ctx = await setup()
    server.addPage({ id: 'r4', title: 'R4', storageHtml: '<p>r</p>', childIds: ['c4'] })
    server.addPage({ id: 'c4', title: 'C4', storageHtml: '<p>c</p>', noLink: true })
    server.failBodyIds = ['r4']
    const result = await call(ctx, 'intranet_wiki_read_page', { pageId: 'r4', scope: 'descendants' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { completeness: string; pages: Record<string, unknown>[] }
    expect(value.completeness).toBe('partial_access')
    expect(value.pages[0]).toMatchObject({ pageId: 'r4', depth: 0 })
    expect(value.pages[0]?.error).toContain('Wiki API 500')
    expect(value.pages[0]?.text).toBeUndefined()
    expect(value.pages[1]).toEqual({
      pageId: 'c4',
      parentPageId: 'r4',
      depth: 1,
      title: 'C4',
      text: 'c',
      truncated: false,
    })
  })

  it('records a discoverable-but-unreadable child as partial_access', async () => {
    const ctx = await setup()
    server.addPage({ id: 'root', title: 'Root', storageHtml: '<p>ok</p>', childIds: ['gone'] })
    const result = await call(ctx, 'intranet_wiki_read_page', { pageId: 'root', scope: 'descendants' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as {
      completeness: string
      failedCount: number
      fetchedCount: number
      pages: { pageId: string; error?: string; text?: string }[]
      warnings: string[]
    }
    expect(value.completeness).toBe('partial_access')
    expect(value.failedCount).toBe(1)
    expect(value.fetchedCount).toBe(1)
    expect(value.pages[1]?.error).toContain('Wiki API 404')
    expect(value.pages[1]?.text).toBeUndefined()
    expect(value.warnings).toContain('1 page(s) failed to load')
  })

  it('splits the per-page budget and flags partial_content when bodies overflow', async () => {
    const ctx = await setup({
      read: {
        defaultMaxChars: 60000,
        maxChars: 100000,
        totalMaxChars: 150000,
        maxDepth: 10,
        defaultMaxPages: 30,
        maxPages: 100,
        defaultMaxCharsPerPage: 20000,
        maxCharsPerPage: 60000,
      },
    })
    server.addPage({ id: 'r', title: 'R', storageHtml: `<p>${'x'.repeat(3000)}</p>`, childIds: ['c'] })
    server.addPage({ id: 'c', title: 'C', storageHtml: `<p>${'y'.repeat(3000)}</p>` })
    const result = await call(ctx, 'intranet_wiki_read_page', {
      pageId: 'r',
      scope: 'descendants',
      maxChars: 2000,
      maxCharsPerPage: 1500,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { completeness: string; contentTruncated: boolean; pages: { text?: string; truncated?: boolean }[] }
    expect(value.contentTruncated).toBe(true)
    expect(value.completeness).toBe('partial_content')
    expect(value.pages[0]?.text).toHaveLength(1500)
    expect(value.pages[1]?.text).toHaveLength(500)
  })

  it('serves an empty body and truncated flag once the total budget is spent', async () => {
    const ctx = await setup()
    server.addPage({ id: 'r2', title: 'R2', storageHtml: `<p>${'x'.repeat(1500)}</p>`, childIds: ['c2'] })
    server.addPage({ id: 'c2', title: 'C2', storageHtml: '<p>tail</p>' })
    const result = await call(ctx, 'intranet_wiki_read_page', {
      pageId: 'r2',
      scope: 'descendants',
      maxChars: 1000,
      maxCharsPerPage: 1500,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { pages: { text?: string; truncated?: boolean }[] }
    expect(value.pages[1]).toMatchObject({ text: '', truncated: true })
  })

  it('stops the descendants walk when cancelled between page reads', async () => {
    const ctx = await setup()
    server.addPage({ id: 'rw', title: 'RW', storageHtml: '<p>r</p>', childIds: ['cw'] })
    server.addPage({ id: 'cw', title: 'CW', storageHtml: '<p>c</p>' })
    server.bodyDelayMs = 5000
    const controller = new AbortController()
    const pending = call(ctx, 'intranet_wiki_read_page', { pageId: 'rw', scope: 'descendants' }, controller.signal)
    setTimeout(() => {
      controller.abort()
    }, 50)
    const result = await pending
    expect(result.isError).toBe(true)
  }, 10_000)

  it('honors exec.signal cancellation mid-call', async () => {
    const ctx = await setup()
    server.addPage({ id: 'slow', title: 'Slow', storageHtml: '<p>s</p>' })
    server.responseDelayMs = 5000
    const controller = new AbortController()
    const pending = call(ctx, 'intranet_wiki_read_page', { pageId: 'slow' }, controller.signal)
    setTimeout(() => {
      controller.abort()
    }, 50)
    const result = await pending
    expect(result.isError).toBe(true)
  }, 10_000)

  it('surfaces wiki HTTP failures as tool errors', async () => {
    const ctx = await setup()
    server.failure = { status: 500, body: 'boom' }
    const result = await call(ctx, 'intranet_wiki_read_page', { pageId: 'x' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('Wiki API 500')
  })

  it('fails with remediation guidance when the credential references are unset', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(tool, {
      baseUrlEnv: 'TEST_INTRANET_WIKI_UNSET_BASE',
      tokenEnv: 'TEST_INTRANET_WIKI_UNSET_TOKEN',
      applyWriteApproval: 'allow',
    })
    const result = await call(ctx, 'intranet_wiki_read_page', { pageId: '1' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unconfigured')
    expect(text(result)).toContain('TEST_INTRANET_WIKI_UNSET_BASE')
  })
})

describe('intranet_wiki_prepare_write', () => {
  it('plans a create_child write against the parent page without writing', async () => {
    const ctx = await setup()
    server.addPage({ id: '9', title: 'Parent', version: 4, spaceKey: 'SP', storageHtml: '<p>p</p>' })
    const result = await call(ctx, 'intranet_wiki_prepare_write', {
      action: 'create_child',
      parentPageId: '9',
      title: 'Review',
      contentMarkdown: '# Title\n\nBody',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toEqual({
      action: 'create_child',
      target: { type: 'child', pageId: '9', title: 'Parent', url: `${server.baseUrl}/pages/viewpage.action?pageId=9` },
      title: 'Review',
      writeMode: 'create child page; original page will not be modified',
      contentMarkdown: '# Title\n\nBody',
      contentSummary: ['Title'],
      contentChars: 13,
    })
    expect(server.writes).toHaveLength(0)
  })

  it('plans an append write with the page version as baseVersion', async () => {
    const ctx = await setup()
    server.addPage({ id: '31', title: 'Target', version: 7, storageHtml: '<p>t</p>' })
    const result = await call(ctx, 'intranet_wiki_prepare_write', {
      action: 'append_page',
      targetWikiUrl: `${server.baseUrl}/pages/viewpage.action?pageId=31`,
      contentMarkdown: 'plain body',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toMatchObject({
      action: 'append_page',
      target: { type: 'page', pageId: '31', title: 'Target' },
      title: 'AI 补充内容',
      writeMode: 'append to page end',
      baseVersion: 7,
      contentSummary: ['plain body'],
    })
  })

  it('omits baseVersion when the target page reports no version', async () => {
    const ctx = await setup()
    server.addPage({ id: 'pv', title: 'PlanNoVersion', storageHtml: '<p>t</p>' })
    const result = await call(ctx, 'intranet_wiki_prepare_write', {
      action: 'append_page',
      pageId: 'pv',
      contentMarkdown: 'body',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect('baseVersion' in (result.value as Record<string, unknown>)).toBe(false)
  })

  it('keeps an explicit append heading label instead of the default', async () => {
    const ctx = await setup()
    server.addPage({ id: '33', title: 'T3', version: 2, storageHtml: '<p>t</p>' })
    const result = await call(ctx, 'intranet_wiki_prepare_write', {
      action: 'append_page',
      pageId: '33',
      title: 'Custom heading',
      contentMarkdown: 'body',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect((result.value as { title: string }).title).toBe('Custom heading')
  })

  it('rejects create_child without parentPageId or title', async () => {
    const ctx = await setup()
    const missingParent = await call(ctx, 'intranet_wiki_prepare_write', {
      action: 'create_child',
      title: 'T',
      contentMarkdown: 'x',
    })
    expect(missingParent.isError).toBe(true)
    expect(text(missingParent)).toContain("'parentPageId' is required")
    const missingTitle = await call(ctx, 'intranet_wiki_prepare_write', {
      action: 'create_child',
      parentPageId: '1',
      contentMarkdown: 'x',
    })
    expect(missingTitle.isError).toBe(true)
    expect(text(missingTitle)).toContain("'title' is required")
  })

  it('rejects append_page without a resolvable page id and blank content', async () => {
    const ctx = await setup()
    const missingTarget = await call(ctx, 'intranet_wiki_prepare_write', {
      action: 'append_page',
      contentMarkdown: 'x',
    })
    expect(missingTarget.isError).toBe(true)
    expect(text(missingTarget)).toContain("Either 'pageId' or 'targetWikiUrl'")
    const blank = await call(ctx, 'intranet_wiki_prepare_write', {
      action: 'append_page',
      pageId: '1',
      contentMarkdown: '   ',
    })
    expect(blank.isError).toBe(true)
    expect(text(blank)).toContain("'contentMarkdown' is required")
  })

  it('rejects an action outside the schema enum at validation time', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'intranet_wiki_prepare_write', {
      action: 'replace_page',
      contentMarkdown: 'x',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('invalid arguments')
  })
})

describe('intranet_wiki_apply_write', () => {
  it('is denied with the gate reason under applyWriteApproval: ask and no approval seam', async () => {
    const ctx = await setup({ applyWriteApproval: 'ask' })
    const result = await call(ctx, 'intranet_wiki_apply_write', {
      action: 'append_page',
      pageId: '31',
      contentMarkdown: 'body',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('This call writes to the intranet wiki.')
    expect(server.writes).toHaveLength(0)
  })

  it('leaves the other tools unasked under applyWriteApproval: ask', async () => {
    const ctx = await setup({ applyWriteApproval: 'ask' })
    server.addPage({ id: '5', title: 'P', storageHtml: '<p>ok</p>' })
    const result = await call(ctx, 'intranet_wiki_read_page', { pageId: '5' })
    expect(result.isError).toBe(false)
  })

  it('creates a child page with the rendered storage body under allow', async () => {
    const ctx = await setup()
    server.addPage({ id: '9', title: 'Parent', version: 4, spaceKey: 'SP', storageHtml: '<p>p</p>' })
    const result = await call(ctx, 'intranet_wiki_apply_write', {
      action: 'create_child',
      parentPageId: '9',
      title: 'Review',
      contentMarkdown: '# Heading\n\n- item',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toEqual({
      status: 'written',
      action: 'create_child',
      pageId: 'created-1',
      title: 'Review',
      url: `${server.baseUrl}/pages/viewpage.action?pageId=created-1`,
      version: 1,
    })
    const write = server.writes[0]
    expect(write?.method).toBe('POST')
    const body = write?.body as { space?: { key?: string }; ancestors?: { id: string }[]; body?: { storage?: { value?: string } } }
    expect(body.space?.key).toBe('SP')
    expect(body.ancestors).toEqual([{ id: '9' }])
    expect(body.body?.storage?.value).toBe('<h1>Heading</h1><ul><li>item</li></ul>')
  })

  it('returns a version_conflict domain outcome instead of an error', async () => {
    const ctx = await setup()
    server.addPage({ id: '31', title: 'Target', version: 8, storageHtml: '<p>t</p>' })
    const result = await call(ctx, 'intranet_wiki_apply_write', {
      action: 'append_page',
      pageId: '31',
      baseVersion: 7,
      contentMarkdown: 'body',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toEqual({
      status: 'version_conflict',
      action: 'append_page',
      pageId: '31',
      message: 'The wiki page has been updated by someone else; run intranet_wiki_prepare_write again before writing back.',
      baseVersion: 7,
      currentVersion: 8,
    })
    expect(server.writes).toHaveLength(0)
  })

  it('appends below an escaped heading at the next version under allow', async () => {
    const ctx = await setup()
    server.addPage({ id: '31', title: 'Target', version: 7, storageHtml: '<p>old</p>' })
    const result = await call(ctx, 'intranet_wiki_apply_write', {
      action: 'append_page',
      pageId: '31',
      baseVersion: 7,
      title: 'A & B',
      contentMarkdown: 'appended',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toMatchObject({ status: 'written', action: 'append_page', pageId: '31', version: 8 })
    const write = server.writes[0]
    expect(write?.method).toBe('PUT')
    const body = write?.body as { version?: { number?: number }; body?: { storage?: { value?: string } } }
    expect(body.version?.number).toBe(8)
    expect(body.body?.storage?.value).toBe('<p>old</p><h2>A &amp; B</h2><p>appended</p>')
  })

  it('appends under the default heading when no title is supplied', async () => {
    const ctx = await setup()
    server.addPage({ id: '32', title: 'T2', version: 1, storageHtml: '' })
    const result = await call(ctx, 'intranet_wiki_apply_write', {
      action: 'append_page',
      pageId: '32',
      contentMarkdown: 'x',
    })
    expect(result.isError).toBe(false)
    const body = server.writes[0]?.body as { body?: { storage?: { value?: string } } }
    expect(body.body?.storage?.value).toContain('<h2>AI 补充内容</h2>')
  })

  it('appends at version 1 when the target page reports no version', async () => {
    const ctx = await setup()
    server.addPage({ id: 'nv', title: 'NoVersion', storageHtml: '<p>n</p>' })
    const result = await call(ctx, 'intranet_wiki_apply_write', {
      action: 'append_page',
      pageId: 'nv',
      contentMarkdown: 'x',
    })
    expect(result.isError).toBe(false)
    const body = server.writes[0]?.body as { version?: { number?: number } }
    expect(body.version?.number).toBe(1)
  })

  it('falls back to the pre-write page fields when the write response is empty', async () => {
    const ctx = await setup()
    server.addPage({ id: '41', title: 'Kept', version: 2, storageHtml: '<p>k</p>' })
    server.blankWriteResponse = true
    const result = await call(ctx, 'intranet_wiki_apply_write', {
      action: 'append_page',
      pageId: '41',
      contentMarkdown: 'x',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toEqual({
      status: 'written',
      action: 'append_page',
      pageId: '41',
      title: 'Kept',
      url: `${server.baseUrl}/pages/viewpage.action?pageId=41`,
    })
  })

  it('reports a created page without echo fields as returned by the API', async () => {
    const ctx = await setup()
    server.addPage({ id: '9', title: 'Parent', spaceKey: 'SP', storageHtml: '<p>p</p>' })
    server.blankWriteResponse = true
    const result = await call(ctx, 'intranet_wiki_apply_write', {
      action: 'create_child',
      parentPageId: '9',
      title: 'T',
      contentMarkdown: 'x',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    // An echo-less create keeps the parent's URL: the client's write parser
    // falls back to the page it read before posting.
    expect(result.value).toEqual({
      status: 'written',
      action: 'create_child',
      pageId: '',
      title: '',
      url: `${server.baseUrl}/pages/viewpage.action?pageId=9`,
    })
  })

  it('fails on create_child when the parent page carries no space key', async () => {
    const ctx = await setup()
    server.addPage({ id: 'nospace', title: 'NoSpace', storageHtml: '<p>n</p>' })
    const result = await call(ctx, 'intranet_wiki_apply_write', {
      action: 'create_child',
      parentPageId: 'nospace',
      title: 'T',
      contentMarkdown: 'x',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('did not include a space key')
  })
})

describe('presentation', () => {
  it('presents read calls as generic read cards naming the target', async () => {
    const ctx = await setup()
    const definition = ctx.tools.get('intranet_wiki_read_page')
    expect(definition?.presentCall?.({ pageId: '12' })).toMatchObject({
      card: 'generic',
      kind: 'read',
      title: 'Read intranet wiki page 12',
    })
    expect(definition?.presentCall?.({ url: 'https://wiki/pages/34', scope: 'descendants' })).toMatchObject({
      title: 'Read intranet wiki page tree 34',
    })
    expect(definition?.presentCall?.({ url: 'https://wiki/display/X' })).toMatchObject({
      title: 'Read intranet wiki page https://wiki/display/X',
    })
    expect(definition?.presentCall?.({})).toMatchObject({ title: 'Read intranet wiki page' })
    expect(definition?.presentCall?.({ url: '   ' })).toMatchObject({ title: 'Read intranet wiki page' })
    expect(definition?.presentCall?.({ scope: 'descendants' })).toMatchObject({ title: 'Read intranet wiki page tree' })
  })

  it('presents prepare and apply calls with the write action and full input', async () => {
    const ctx = await setup()
    const prepare = ctx.tools.get('intranet_wiki_prepare_write')
    expect(prepare?.presentCall?.({ action: 'create_child', contentMarkdown: 'x' })).toMatchObject({
      card: 'generic',
      kind: 'read',
      title: 'Prepare intranet wiki write (create_child)',
    })
    const apply = ctx.tools.get('intranet_wiki_apply_write')
    expect(apply?.presentCall?.({ action: 'create_child', parentPageId: '9', title: 'T', contentMarkdown: 'x' })).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Write intranet wiki: create child page under 9',
      rawInput: { action: 'create_child', parentPageId: '9', title: 'T', contentMarkdown: 'x' },
    })
    expect(apply?.presentCall?.({ action: 'append_page', targetWikiUrl: 'https://wiki?pageId=5', contentMarkdown: 'x' }))
      .toMatchObject({ title: 'Write intranet wiki: append to page 5' })
    expect(apply?.presentCall?.({ action: 'append_page', contentMarkdown: 'x' }))
      .toMatchObject({ title: 'Write intranet wiki: append to page ?' })
    expect(apply?.presentCall?.({ action: 'append_page', parentPageId: '7', contentMarkdown: 'x' }))
      .toMatchObject({ title: 'Write intranet wiki: append to page 7' })
    expect(apply?.presentCall?.({ action: 'append_page', parentPageId: '  ', contentMarkdown: 'x' }))
      .toMatchObject({ title: 'Write intranet wiki: append to page ?' })
    expect(apply?.presentCall?.({ action: 'create_child', contentMarkdown: 'x' }))
      .toMatchObject({ title: 'Write intranet wiki: create child page under ?' })
  })

  it('marks reads and prepares concurrency-safe and the write exclusive', async () => {
    const ctx = await setup()
    expect(ctx.tools.get('intranet_wiki_read_page')?.isConcurrencySafe?.({ pageId: '1' })).toBe(true)
    expect(ctx.tools.get('intranet_wiki_prepare_write')?.isConcurrencySafe?.({ action: 'append_page', pageId: '1', contentMarkdown: 'x' })).toBe(true)
    expect('isConcurrencySafe' in (ctx.tools.get('intranet_wiki_apply_write') ?? {})).toBe(false)
  })

  it('declares the configured cooperative timeouts on the definitions', async () => {
    const ctx = await setup({ readTimeoutMs: 1234, writeTimeoutMs: 567 })
    expect(ctx.tools.get('intranet_wiki_read_page')?.timeoutMs).toBe(1234)
    expect(ctx.tools.get('intranet_wiki_prepare_write')?.timeoutMs).toBe(567)
    expect(ctx.tools.get('intranet_wiki_apply_write')?.timeoutMs).toBe(567)
  })
})
