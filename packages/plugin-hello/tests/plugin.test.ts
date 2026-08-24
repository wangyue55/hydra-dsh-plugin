import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

describe('@hydra-dsh/plugin-hello', () => {
  it('exports the function-plugin contract (no default export)', () => {
    expect(plugin.name).toBe('hydra-hello')
    expect(plugin.inject).toContain('tools')
    expect(typeof plugin.apply).toBe('function')
    expect(plugin).not.toHaveProperty('default')
  })

  it('fills config defaults through the schema', () => {
    expect(plugin.Config()).toEqual({ greeting: 'Hello' })
  })

  it('rejects a mistyped config at load time', () => {
    expect(() => plugin.Config({ greeting: 42 as never })).toThrow()
  })
})
