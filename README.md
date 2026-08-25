# hydra-dsh-plugins

DeepSeek Harness（dsh）第三方插件集合，独立于 dsh 仓库开发、发布与安装。每个插件是一个独立的 npm 包（dsh Bundle），用户通过 `dsh plugin` 逐个安装、卸载、升级。

## 插件目录

| 包 | 说明 | 安装 |
|---|---|---|
| [`@hydra-dsh/plugin-hello`](packages/plugin-hello) | 模板插件：可配置问候语的 `hydra_greet` 工具 | `dsh plugin --profile web add @hydra-dsh/plugin-hello` |
| [`@hydra-dsh/plugin-notify`](packages/plugin-notify) | macOS 任务完成/出错系统通知（每轮 turn 结束，状态 + 耗时） | `dsh plugin --profile web add @hydra-dsh/plugin-notify` |

## 用户侧使用

```sh
dsh plugin --profile web add @hydra-dsh/plugin-hello      # 安装
dsh plugin --profile web update @hydra-dsh/plugin-hello   # 升级
dsh plugin --profile web remove @hydra-dsh/plugin-hello   # 卸载
dsh --profile web --dump-config                           # 不启动，检查生效的配置层
```

Bundle 的增删/升级在 profile 重启后生效；profile 自己的 `cordis.patch.yml` 编辑走热重载。插件配置项见各包 README；在 profile 的 `cordis.patch.yml` 里按 id 覆盖（整个 `config` 替换，不深合并）。

## 兼容表

dsh 处于 rc 阶段且无兼容承诺，本仓库每轮发布锚定一个实测的 dsh 版本：

| 本仓库 | 要求的 dsh |
|---|---|
| 0.1.x | `@deepseek-ai/dsh` 0.1.1-rc.2 |

## 开发

```sh
pnpm install        # 安装依赖（含 @deepseek-ai/* 类型），prepare 顺带构建各包
pnpm typecheck
pnpm test
pnpm build
```

约定（与 dsh 官方一致）：

- 函数插件具名导出 `name` / `inject` / `Config` / `apply`，**不写 default export**（混用会让 Loader 丢弃函数插件命名空间）。
- 依赖三分法：宿主提供的包（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-*` 服务定义）进 **peerDependencies**（运行时解析到 dsh 安装自身，绝不能放 dependencies，否则会出现第二个 cordis 实例）；插件自己的第三方库进 **dependencies**；peer 的本地副本 + tsdown + typescript 进 **devDependencies**（tsdown/typescript 必须在包内，git 安装的 `prepare` 要独立可运行）。
- 配置用 Schemastery schema，默认值写在 schema 上；部署间可能不同的值一律做成配置字段。
- 只依赖服务定义（Service Definition），不依赖具体 provider。

### 新插件

复制 `packages/plugin-hello` 改名，改 `package.json` 的 `name`/`description`、`cordis.patch.yml` 的行 id 与包名，然后在本 README 的插件目录表加一行。

### 本地联调

```sh
dsh plugin --profile hydra-dev add /绝对路径/hydra-dsh-plugins/packages/plugin-hello
dsh --profile hydra-dev --dump-config    # 应出现 "# == @hydra-dsh/plugin-hello" 层
dsh --profile hydra-dev
```

本地目录以 pnpm link 方式安装：改代码后 `pnpm build`，重启 profile 即生效，无需重装。

## 发布

变更走 changesets：PR 里 `pnpm changeset` 记录受影响的包与 semver 级别；合并到 main 后 Release 工作流开 "Version Packages" PR，合并即发布到 npm。仓库需配置 secret `NPM_TOKEN`（npm automation token），首次发布前需在 npm 上拥有 `@hydra-dsh` scope（组织）。
