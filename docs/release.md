# 发布与维护

面向仓库维护者：版本策略、发布 runbook、dsh 升级适配、退役流程与安全。

> **当前状态：npm 发布暂缓，Release 工作流已手动禁用**（`gh workflow disable Release`）。changeset 照常记录、随 PR 累积；插件安装走本地目录或 git 直装（见[用户手册](user-guide.md)）。恢复发布时依次：注册 npm 组织 `@hydra-dsh` → 配置仓库 secret `NPM_TOKEN` → 仓库设置里允许 Actions 创建 PR（Settings → Actions → General → Workflow permissions）→ `gh workflow enable Release`，下一次 push 即恢复全流程。

## 版本策略

- 各包独立 semver（changesets 独立模式）。插件语境的判级：**major** = 用户必须动手（配置键改名/删除、行为不兼容）；**minor** = 新能力、新配置项（带默认值即可）；**patch** = 修复与文案。
- **新包从 `0.0.0` 起步**：首个 minor changeset 使首发恰好 0.1.0。
- 兼容表（根 README）记录"本仓库版本区间 ↔ 实测 dsh 版本"，随每轮发布更新。

## 发布 runbook

常规路径（自动）：

1. PR 携带 changeset（`pnpm changeset`，用户视角一句话：升级后你会得到什么 / 需要做什么）。
2. 合并 main → Release 工作流开或更新 "Version Packages" PR（聚合版本号与 CHANGELOG）。
3. 合并该 PR → 自动 `changeset publish` 发 npm。

手动兜底（工作流不可用时），顺序不可颠倒：

```sh
pnpm version-packages   # 先跑：消费 changeset、写版本号与 CHANGELOG
```

```sh
pnpm release            # 后跑。跳过上一步会把 0.0.0 发出去
```

首次发布 checklist：npm 组织 `@hydra-dsh` 已创建；`NPM_TOKEN`（automation token）已配进仓库 secrets；包名二次确认；发布后 `npm view <包名> version` 验证可见；**meta-bundle 端到端验证**——依赖物化这一步只有发布后才真实可验（本地 link 安装解析不到成员包），用一次性 `DSH_HOME` 走完整用户流程：

```sh
DSH_HOME=/tmp/dsh-publish-verify dsh plugin --profile t add @hydra-dsh/intranet
DSH_HOME=/tmp/dsh-publish-verify dsh --profile t --dump-config   # 三个成员行齐
DSH_HOME=/tmp/dsh-publish-verify dsh --profile t                 # 启动无错即通过，完后 rm -rf /tmp/dsh-publish-verify
```

## dsh 升级适配流程

dsh 处于 rc 阶段、无兼容承诺，升级按整仓一轮走：

1. 升级各包 devDependencies 里的 `@deepseek-ai/*` 到目标版本，`pnpm install`。
2. 全量 `pnpm test && pnpm typecheck && pnpm build`，修复破坏。
3. 同步 peerDependencies 范围到实测版本。
4. 更新根 README 兼容表。
5. 受影响的包各记 changeset，集中发一轮。

## 退役流程

1. 包 README 顶部标注弃用与替代方案；`dsh.catalog.status` 改 `deprecated`（目录表自动停发安装命令），`pnpm gen:catalog`。
2. 发一个标注弃用的 patch 版本，然后 `npm deprecate <包名> "<原因与替代>"`。
3. 包永不从 npm 删除——已装用户的 `update` / `remove` 流程必须保持可用。

## 安全

- `NPM_TOKEN` 用 automation token，疑似泄露立即轮换。
- **`prepare` 脚本是高敏面**：git 安装的用户等于授权在安装期（沙箱之外）执行它。任何对 `prepare` 或构建配置的改动必须在 changeset 里显式声明。
- 任何文档、示例、测试中不出现真实密钥，一律用占位符。
