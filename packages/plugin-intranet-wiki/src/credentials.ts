/**
 * Endpoint resolution for the intranet wiki tools. Configuration carries
 * credential reference names; the values resolve per call through
 * `ctx.credentials` when that seam is composed, otherwise from the launch
 * environment, and a missing value fails with remediation guidance.
 * @module @hydra-dsh/plugin-intranet-wiki/src/credentials
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { WikiEndpoint } from './types.ts'

/**
 * Resolve one credential reference: the credentials seam when composed, the
 * launch environment otherwise.
 * @param ctx - consuming plugin context.
 * @param refName - configured reference name.
 * @returns the non-empty value, or `undefined` while unconfigured.
 */
async function resolveReference(ctx: Context, refName: string): Promise<string | undefined> {
  const ref = credentialRef(refName)
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const resolved = (await credentials.resolve(ref))?.value
    return resolved !== undefined && resolved.length > 0 ? resolved : undefined
  }
  // Without the seam the launch environment is the whole credential plane.
  const ambient = launchEnvironmentOf(ctx).get(refName)
  return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
}

/**
 * Resolve the wiki endpoint from the configured base-URL and token references.
 * @param ctx - consuming plugin context.
 * @param refs - configured reference names.
 * @returns the endpoint with a trailing-slash-free base URL.
 */
export async function resolveWikiEndpoint(
  ctx: Context,
  refs: { baseUrlEnv: string; tokenEnv: string },
): Promise<WikiEndpoint> {
  const baseUrl = await resolveReference(ctx, refs.baseUrlEnv)
  const token = await resolveReference(ctx, refs.tokenEnv)
  const missing = [
    ...baseUrl === undefined ? [refs.baseUrlEnv] : [],
    ...token === undefined ? [refs.tokenEnv] : [],
  ]
  if (baseUrl === undefined || token === undefined) {
    throw new Error(
      `The intranet wiki endpoint is unconfigured: no value for ${missing.join(', ')}.`
      + ' Store the values through the credentials service, export them in the launching'
      + ' environment, or point the tool config at different reference names.',
    )
  }
  return { baseUrl: baseUrl.trim().replace(/\/+$/, ''), token: token.trim() }
}
