# 插件开发 Cookbook

从想法到发布的完整流程。硬性纪律见 [AGENTS.md](../AGENTS.md)；发布与版本策略见 [release](release.md)。

## 0. 环境

- Node `^22.19 || >=24`、pnpm；仓库根 `pnpm install` 后 `pnpm test` 全绿即就绪。
- 本地要有一个可实验的 dsh：`npm install -g @deepseek-ai/dsh`（版本对齐根 README 兼容表）。

## 1. 起包：复制活模板

```sh
cp -R packages/plugin-hello packages/plugin-<name>
```

逐处修改：

- `package.json`：`name`（`@hydra-dsh/plugin-<name>`）、`description`（中文一句话——它同时是 npm 文案和目录表"说明"列）、`dsh.catalog`（新插件从 `status: experimental` 起步）、`version` 保持 `0.0.0`；
- `cordis.patch.yml`：行 `id` 与包名。**每个出现在目录表里的插件都必须带 `dsh.bundle` + 最小 patch**——没有它的包 `add` 后不激活任何层，目录表的安装命令就成了谎言（设置卡曾因此返工）；只有纯库（供插件 import、不供用户启用）才省略 `dsh.bundle`；
- `src/` 与 `tests/`：清成自己的最小骨架，**保留契约测试**（具名导出、无 default、Config 默认值）；
- `tsconfig.json`：源码用到 `process` / `fetch` / `Buffer` 等 Node 全局时补 `"types": ["node"]`（基础配置的 lib 只有 ES2022，无 DOM——fetch 一族的类型也来自 @types/node；`HeadersInit` 这类纯 DOM 类型用 `Record<string, string>` 等具体类型替代）。

然后 `pnpm install && pnpm gen:catalog`，目录表自动带上新行。

## 2. 开发循环：TDD + 本地联调

先写失败的测试，再实现。需要真实宿主验证时，以 link 方式装进专用 dev profile：

```sh
pnpm --filter @hydra-dsh/plugin-<name> build
dsh plugin --profile dev add "$(pwd)/packages/plugin-<name>"
dsh --profile dev --dump-config
```

`--dump-config` 里应出现 `# == @hydra-dsh/plugin-<name>` 层。改代码后 `build` + 重启 profile 即生效——link 免重装，不免重启。不想污染真实环境时，给命令加 `DSH_HOME=/tmp/dsh-sandbox` 前缀，把整个实验隔离进临时目录。

**meta-bundle 的本地联调边界**：link 安装的 bundle 解析不到它的 workspace 成员依赖（Loader 从 profile 目录解析插件行，而 pnpm 不为 link 包安装依赖）——发布到 npm 后 pnpm 会物化成员进 profile，此问题消失。发布前的替代：成员各自独立 link 安装（双轨正是为此而生），或沙盒里把成员手工 symlink 进 `profiles/<name>/node_modules/@hydra-dsh/`（等价还原发布后形态）；bundle 走 npm 的完整链路留给首发清单验证（见 [release](release.md)）。

## 3. 验证矩阵

| 层次 | 手段 | 什么时候必须 |
|---|---|---|
| 纯函数 | vitest 单测 | 一切格式化/构造逻辑 |
| 导出契约 | 契约测试（模板自带） | 每个插件 |
| 监听/接线 | fake ctx + mock 边界模块 | 有事件监听的插件 |
| 组合 | `--dump-config` 层检查 | 每次改 patch、包名或配置 |
| 浏览器端 | 真实 `dsh web` 启动：`/plugins/<包名>/client.js` 返回 200 + 设置页/槽位实际渲染 | 带 `dsh.client` 的插件 |
| 真机 | 手动 checklist 写进 PR | 不可自动化的效果（系统弹窗、声音等） |

注意 **CI 在 ubuntu**：darwin 路径必须显式 stub 平台（参照 plugin-notify 测试里的 `withPlatform`）。

## 3.5 浏览器端插件（`dsh.client`，进阶）

带 Web UI 半边的插件是一等 out-of-tree 能力：宿主的 client-modules 服务扫描组合行清单里的 `dsh.client` 声明，经 `/plugins/<包名>/client.js` 把浏览器半边送进页面。完整工作范例是 [`plugin-intranet-settings-card`](../packages/plugin-intranet-settings-card)（照抄它的 tsdown 双面构建起步）。三个必须知道的耦合点：

1. **产物形态**：浏览器半边不是普通 bundle，是挂进宿主 module-table 的**闭包工厂**（CJS 包进 `window.__ModuleLoader__.load`，externals 经注入的 require 解析；CSS modules 由 lightningcss 内联注入）。
2. **`CLIENT_EXTERNALS` 与 dsh 版本耦合**：外部表 = 宿主平台基线（react、cordis、ui-slots、ui-primitives 等）+ 本包 `dsh.client.inject` 各行——基线抄自上游 `packages/client/web/src/platform.ts`，**升级 dsh 时必须对照核对**，漂移即浏览器端加载失败。
3. **产物面的测试边界**：官方包只发布 lib 不发布 src，`<包名>/client` 的值导入在 Node 下不可测（闭包工厂无导出）——纯组件/纯逻辑直接从 `../src/` 相对导入测（jsdom pragma 按需）；触及宿主运行时的值（如 `createSnapshotStore`）用最小忠实桩 `vi.mock`；真正的集成面交给上表"浏览器端"一行的真机启动验证。

## 4. 出货清单（合并前自查）

- [ ] `pnpm test` / `pnpm typecheck` / `pnpm build` 全绿
- [ ] 包 README 齐五节：安装、行为表、与 Schema 一致的配置表、Model Experience、已知限制
- [ ] `dsh.catalog` 字段就位，`pnpm gen:catalog` 已跑并提交 README
- [ ] `pnpm changeset`（用户视角一句话）
- [ ] 真机手动项已验证并在 PR 里勾选

## 5. 发布

合并 main 后由 Release 工作流接管（Version PR → 合并即发 npm）；细节与手动兜底见 [release](release.md)。
