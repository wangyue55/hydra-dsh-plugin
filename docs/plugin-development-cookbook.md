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
- `cordis.patch.yml`：行 `id` 与包名；
- `src/` 与 `tests/`：清成自己的最小骨架，**保留契约测试**（具名导出、无 default、Config 默认值）。

然后 `pnpm install && pnpm gen:catalog`，目录表自动带上新行。

## 2. 开发循环：TDD + 本地联调

先写失败的测试，再实现。需要真实宿主验证时，以 link 方式装进专用 dev profile：

```sh
pnpm --filter @hydra-dsh/plugin-<name> build
dsh plugin --profile dev add "$(pwd)/packages/plugin-<name>"
dsh --profile dev --dump-config
```

`--dump-config` 里应出现 `# == @hydra-dsh/plugin-<name>` 层。改代码后 `build` + 重启 profile 即生效——link 免重装，不免重启。不想污染真实环境时，给命令加 `DSH_HOME=/tmp/dsh-sandbox` 前缀，把整个实验隔离进临时目录。

## 3. 验证矩阵

| 层次 | 手段 | 什么时候必须 |
|---|---|---|
| 纯函数 | vitest 单测 | 一切格式化/构造逻辑 |
| 导出契约 | 契约测试（模板自带） | 每个插件 |
| 监听/接线 | fake ctx + mock 边界模块 | 有事件监听的插件 |
| 组合 | `--dump-config` 层检查 | 每次改 patch、包名或配置 |
| 真机 | 手动 checklist 写进 PR | 不可自动化的效果（系统弹窗、声音等） |

注意 **CI 在 ubuntu**：darwin 路径必须显式 stub 平台（参照 plugin-notify 测试里的 `withPlatform`）。

## 4. 出货清单（合并前自查）

- [ ] `pnpm test` / `pnpm typecheck` / `pnpm build` 全绿
- [ ] 包 README 齐五节：安装、行为表、与 Schema 一致的配置表、Model Experience、已知限制
- [ ] `dsh.catalog` 字段就位，`pnpm gen:catalog` 已跑并提交 README
- [ ] `pnpm changeset`（用户视角一句话）
- [ ] 真机手动项已验证并在 PR 里勾选

## 5. 发布

合并 main 后由 Release 工作流接管（Version PR → 合并即发 npm）；细节与手动兜底见 [release](release.md)。
