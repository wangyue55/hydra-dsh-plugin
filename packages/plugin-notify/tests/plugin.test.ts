import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

describe('@hydra-dsh/plugin-notify exports', () => {
  it('exports the function-plugin contract (no default, no inject)', () => {
    expect(plugin.name).toBe('hydra-notify')
    expect(typeof plugin.apply).toBe('function')
    expect(Object.hasOwn(plugin, 'default')).toBe(false)
    expect(Object.hasOwn(plugin, 'inject')).toBe(false)
  })

  it('fills config defaults through the schema', () => {
    expect(plugin.Config()).toEqual({ sound: '' })
  })

  it('rejects a mistyped config at load time', () => {
    expect(() => plugin.Config({ sound: 42 as never })).toThrow()
  })
})
