import { describe, expect, it } from 'vitest'
import { analyzeCodeSource } from '../src/code-analyzer.ts'
import type { CodeFile } from '../src/types.ts'

const SOURCE = {
  projectId: '42',
  projectName: 'heads-h5',
  projectPath: 'ficc/heads-h5',
  ref: 'main',
  paths: ['src'],
}

function file(path: string, content: string, language = 'ts'): CodeFile {
  return { path, language, content, size: Buffer.byteLength(content, 'utf-8') }
}

describe('analyzeCodeSource', () => {
  it('summarizes imports, exports, symbols, api calls, and routes per file', () => {
    const content = [
      "import { a } from './a'",
      "const x = require('legacy')",
      'export class HeadsService {}',
      'export default function boot() {}',
      'interface Row {}',
      'const CONFIG = 1',
      "name: 'heads-view'",
      "fetch('/api/heads')",
      "axios.get('/api/list')",
      "url: '/api/raw'",
      "@Get('items')",
      "@Post('submit')",
      "path: '/heads'",
    ].join('\n')
    const result = analyzeCodeSource(SOURCE, [file('src/service/heads.service.ts', content)])
    const summary = result.files[0]
    expect(summary?.imports).toEqual(['./a', 'legacy'])
    expect(summary?.exports).toEqual(['HeadsService', 'boot'])
    expect(summary?.symbols).toContain('HeadsService')
    expect(summary?.symbols).toContain('CONFIG')
    expect(summary?.symbols).toContain('heads-view')
    expect(summary?.apiCalls).toEqual(['/api/heads', '/api/list', '/api/raw'])
    expect(summary?.routes).toEqual(['GET /items', 'POST /submit', '/heads'])
    expect(result.dependencies).toEqual(['./a', 'legacy'])
    expect(result.services).toContain('HeadsService')
    expect(result.sideEffects).toEqual([
      'calls frontend APIs or external services',
      'has write endpoints or state-changing entry points',
    ])
  })

  it('collects components from view files, falling back to the basename', () => {
    const result = analyzeCodeSource(SOURCE, [
      file('src/views/HeadsPage.vue', '<template><div/></template>', 'vue'),
      file('src/views/Board.tsx', 'export function Board() {}', 'tsx'),
    ])
    expect(result.components).toContain('HeadsPage')
    expect(result.components).toContain('Board')
  })

  it('collects DTO symbols from type-flavored paths', () => {
    const result = analyzeCodeSource(SOURCE, [
      file('src/types/order.dto.ts', 'export interface OrderDto {}'),
    ])
    expect(result.dtos).toEqual(['OrderDto'])
  })

  it('defaults the project type and reports no side effects for pure code', () => {
    const result = analyzeCodeSource(SOURCE, [file('src/pure.ts', 'export const one = 1')])
    expect(result.source.projectType).toBe('auto')
    expect(result.sideEffects).toEqual([])
    expect(result.fileCount).toBe(1)
  })

  it('honors an explicit project type', () => {
    const result = analyzeCodeSource({ ...SOURCE, projectType: 'vue' }, [])
    expect(result.source.projectType).toBe('vue')
  })

  it('routes without write verbs report only the API side effect', () => {
    const result = analyzeCodeSource(SOURCE, [
      file('src/read.ts', "fetch('/api/x')\npath: '/read-only'"),
    ])
    expect(result.sideEffects).toEqual(['calls frontend APIs or external services'])
  })

  it('falls back to file basenames for symbol-less components and services', () => {
    const result = analyzeCodeSource(SOURCE, [
      file('src/views/bare.tsx', '<div/>', 'tsx'),
      file('src/api/probe.ts', '// nothing declared'),
    ])
    expect(result.components).toEqual(['bare'])
    expect(result.services).toEqual(['probe'])
  })

  it('caps the per-file extraction lists', () => {
    const manyImports = Array.from({ length: 50 }, (_, i) => `import { a${i} } from './m${i}'`).join('\n')
    const result = analyzeCodeSource(SOURCE, [file('src/big.ts', manyImports)])
    expect(result.files[0]?.imports).toHaveLength(40)
  })
})
