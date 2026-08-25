import { defineConfig } from 'tsdown'

// 自包含构建：git 安装通过 `prepare` 在用户机器上运行本配置，
// 只依赖本包自己的 devDependencies，不假设 monorepo 上下文。
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  outDir: 'lib',
  dts: true,
  clean: true,
  // "type": "module" 下产出 .js/.d.ts（默认为 .mjs/.d.mts），对齐 main/types 字段。
  fixedExtension: false,
})
