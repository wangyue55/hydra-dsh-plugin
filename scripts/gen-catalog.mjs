#!/usr/bin/env node
// 从各包 package.json（description + dsh.catalog）生成 README 插件目录表，
// 幂等替换 <!-- catalog:start --> 与 <!-- catalog:end --> 之间的区块。
// 用法：node scripts/gen-catalog.mjs [--check]
//   --check 只比对不写入：目录表过期时打印提示并以退出码 1 失败（CI 新鲜度门禁）。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORDER = ['stable', 'experimental', 'template', 'deprecated']
const LABEL = { stable: '稳定', experimental: '实验', template: '模板', deprecated: '已弃用' }

const rows = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const manifest = JSON.parse(readFileSync(join(root, 'packages', entry.name, 'package.json'), 'utf8'))
    const catalog = manifest.dsh?.catalog
    if (!catalog || !ORDER.includes(catalog.status) || typeof catalog.platform !== 'string') {
      throw new Error(`packages/${entry.name}: package.json 缺少有效的 dsh.catalog（status ∈ ${ORDER.join('|')}，platform 为字符串）`)
    }
    return { dir: entry.name, name: manifest.name, description: manifest.description ?? '', ...catalog }
  })
  .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name))

const table = [
  '| 包 | 说明 | 平台 | 状态 | 安装 |',
  '|---|---|---|---|---|',
  ...rows.map((row) => {
    const install = row.status === 'deprecated' ? '—' : `\`dsh plugin --profile web add ${row.name}\``
    return `| [\`${row.name}\`](packages/${row.dir}) | ${row.description} | ${row.platform} | ${LABEL[row.status]} | ${install} |`
  }),
].join('\n')

const readmePath = join(root, 'README.md')
const readme = readFileSync(readmePath, 'utf8')
const pattern = /(<!-- catalog:start -->)[\s\S]*?(<!-- catalog:end -->)/
if (!pattern.test(readme)) throw new Error('README.md 缺少 <!-- catalog:start --> / <!-- catalog:end --> 标记')
const next = readme.replace(pattern, `$1\n${table}\n$2`)

if (process.argv.includes('--check')) {
  if (next !== readme) {
    console.error('插件目录表已过期：请运行 pnpm gen:catalog 并提交 README.md')
    process.exit(1)
  }
  console.log('目录表新鲜度检查通过')
} else if (next !== readme) {
  writeFileSync(readmePath, next)
  console.log(`README.md 目录表已更新（${rows.length} 个插件）`)
} else {
  console.log('目录表已是最新')
}
