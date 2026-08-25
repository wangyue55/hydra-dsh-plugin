// Real-API smoke against the company GitLab. Self-skips without the intranet
// credentials so keyless CI and off-VPN machines stay green; the analysis is
// read-only.
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as tool from '../src/index.ts'

const BASE_ENV = 'INTRANET_GITLAB_BASE_URL'
const TOKEN_ENV = 'INTRANET_GITLAB_TOKEN'
const PROJECT_ENV = 'INTRANET_GITLAB_E2E_PROJECT'
const PATH_ENV = 'INTRANET_GITLAB_E2E_PATH'

const hasTarget = process.env[BASE_ENV] !== undefined
  && process.env[TOKEN_ENV] !== undefined
  && process.env[PROJECT_ENV] !== undefined
  && process.env[PATH_ENV] !== undefined

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe.skipIf(!hasTarget)('intranet GitLab real-API', () => {
  it('analyzes the configured project path read-only', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(tool, {})
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('gitlab-e2e-1'),
      name: 'intranet_gitlab_analyze_code_source',
      arguments: {
        projectLocator: process.env[PROJECT_ENV],
        paths: [process.env[PATH_ENV]],
      },
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected analysis success')
    const value = result.value as { project: { projectId: string }; analysis: { fileCount: number } | null }
    expect(value.project.projectId).toBeTruthy()
    expect(value.analysis === null || value.analysis.fileCount >= 0).toBe(true)
  }, 120_000)
})
