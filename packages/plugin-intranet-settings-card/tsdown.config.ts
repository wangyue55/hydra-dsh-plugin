import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig } from 'tsdown'

const ID = '@hydra-dsh/plugin-intranet-settings-card'

// 宿主 module-table 能应答的说明符：dsh 0.1.2-alpha.2 的平台基线
// （PLATFORM_MODULES + PRELOADED_CLIENT_EXTERNALS）加本包 dsh.client.inject
// 各包的 /client 行。表内保持 external 由 require 解析；其余全部内联。
// dsh 升级时须对照上游 packages/client/web/src/platform.ts 核对基线。
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-api-remotes/client',
  '@deepseek-ai/dsh-client-locale/client',
  '@deepseek-ai/dsh-client-ui-settings/client',
  '@deepseek-ai/dsh-client-ui-settings-plugins/client',
])

// 虚拟 id 前缀把 module.css 挡在 tsdown 自带 css 管线之外（其守卫匹配以
// .css 结尾的 id，所以虚拟 id 必须换后缀）。
const CSS_VIRTUAL_PREFIX = '\0hydra-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** 产出一个插件自有的样式注入模块：执行时注入 <style>，默认导出哈希类名表。 */
function styleInjectionModule(fileId: string, css: string, classMap: Record<string, string>): string {
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${ID}/${basename(fileId)}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

export default defineConfig([
  {
    // 节点半边：settings 命名空间注册（普通 ESM 库）。
    entry: ['src/index.ts'],
    format: 'esm',
    outDir: 'lib',
    dts: true,
    clean: true,
    fixedExtension: false,
  },
  {
    // 浏览器半边：宿主 module-table 的闭包工厂产物（CJS 包裹进
    // window.__ModuleLoader__.load，externals 经注入的 require 解析）。
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    sourcemap: true,
    clean: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    deps: {
      neverBundle: (specifier: string) => CLIENT_EXTERNALS.has(specifier),
      alwaysBundle: (specifier: string) => !CLIENT_EXTERNALS.has(specifier),
    },
    plugins: [{
      name: 'hydra-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer === undefined ? source : resolvePath(dirname(importer), source)
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: await readFile(fileId),
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
          classMap[local] = exp.name
        }
        return styleInjectionModule(fileId, code.toString(), classMap)
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
