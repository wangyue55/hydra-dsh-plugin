# AGENTS.md

hydra-dsh-plugins 是 DeepSeek Harness（dsh）的第三方插件 monorepo：pnpm workspace，每个插件一个独立发布的 npm 包（dsh Bundle）。本文件是仓库开发规范，AI 与人共用；`CLAUDE.md` 是它的符号链接。流程见 [插件开发 Cookbook](docs/plugin-development-cookbook.md)，发布与维护见 [release](docs/release.md)。

## 布局

```
packages/<plugin>/       一个插件 = 一个包：src/ + tests/ + cordis.patch.yml + README.md
scripts/gen-catalog.mjs  README 插件目录表生成器（事实源：各包 package.json 的 description + dsh.catalog）
docs/                    user-guide / plugin-development-cookbook / release
```

`packages/plugin-hello` 是活模板：新插件从复制它开始；它被 CI 全量测试，因此模板永不腐烂。

## 命令

```sh
pnpm install                  # 安装依赖，prepare 顺带构建各包
pnpm build                    # 全仓构建；单包用 pnpm --filter <包名> <script>
pnpm typecheck
pnpm test
pnpm gen:catalog              # 重新生成 README 目录表（CI 以 --check 校验新鲜度）
pnpm changeset                # 记录一次发布变更
```

## 硬性纪律（每条都源于真实事故或 dsh 官方 postmortem）

- **依赖三分法**：宿主提供的包（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-*`）只进 peerDependencies（devDependencies 重复一份供本地类型检查）；插件自己的第三方库进 dependencies；tsdown + typescript 必须在包内 devDependencies（git 安装的 `prepare` 要独立可运行）。宿主包误入 dependencies 会在 profile 里装出第二个 cordis 实例，服务注册进错误上下文。
- **函数插件具名导出** `name` / `Config` / `apply`，禁止 default export——混用会让 Loader 丢弃函数插件的命名空间（dsh 官方 postmortem）。
- **`@deepseek-ai/dsh-*` 只允许 type-only import**：运行时值一律来自 cordis 回调参数，保证运行时解析零额外面。
- **CI 在 ubuntu 跑测试**：所有走 darwin 分支的测试必须用 `withPlatform('darwin', …)` 显式覆盖 `process.platform`。
- **tsdown 配置必须 `fixedExtension: false`**：否则产出 `.mjs` 与 package.json 的 `main: lib/index.js` 脱节。
- **外部命令 argv 用 `--` 终止选项解析**：dash 开头的动态文本（如错误消息首行）会被 getopt 吃成旗标（osascript 实证，本仓库终审抓获）。
- **配置用 Schemastery**，默认值写在 schema 上；部署间可能不同的值一律做成配置字段，不硬编码。
- **版本从 `0.0.0` 起步**：minor changeset 使首发恰好 0.1.0；手动发布必须 `version-packages` 先于 `release`（否则会把 0.0.0 发出去）。
- 文件以恰好一个换行结尾。

## 质量门（合并前提）

- `pnpm test` 与 `pnpm typecheck` 全绿；新代码走 TDD（先有失败测试再实现）。
- 新插件同 PR 必须携带：包 README（含与 Schema 一致的配置表）、`dsh.catalog` 字段、changeset、`pnpm gen:catalog` 后的 README。
- 行为变更（配置键、默认值、模型可见文案等）同 PR 更新包 README 与 changeset。

## 文档规则

- **One home per fact**：插件目录表由脚本生成（事实源在各包 package.json）；兼容表只在根 README；配置字段只在包 README 的配置表——其余位置一律放链接，不抄写。
- 语言：中文。package.json 的 `description` 也用中文——它同时是 npm 页文案与目录表"说明"列，一处维护。
- 包 README 固定节奏：一句话 → 安装 → 行为表 → 配置表 → Model Experience → 已知限制。
- 设计讨论与执行计划是工作过程产物，不入库；当前真相只存在于代码、测试与 README。
