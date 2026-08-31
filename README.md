# hydra-dsh-plugins

DeepSeek Harness（dsh）第三方插件集合：每个插件是一个独立的 npm 包（dsh Bundle），独立安装、升级、卸载，互不影响。

## 插件目录

<!-- catalog:start -->
| 包 | 说明 | 平台 | 状态 | 安装 |
|---|---|---|---|---|
| [`@hydra-dsh/intranet`](packages/intranet) | 内网能力全家桶：Wiki 读写（写入过审批）+ GitLab 代码分析，一装齐 | all | 稳定 | `dsh plugin --profile web add @hydra-dsh/intranet` |
| [`@hydra-dsh/plugin-intranet-gitlab`](packages/plugin-intranet-gitlab) | 内网 GitLab 代码分析工具：项目解析、线索驱动的范围发现、有界读取与影响分析 | all | 稳定 | `dsh plugin --profile web add @hydra-dsh/plugin-intranet-gitlab` |
| [`@hydra-dsh/plugin-intranet-wiki`](packages/plugin-intranet-wiki) | 内网 Wiki 工具：预算受控的页面读取 + 两步式回写，执行步经人工审批 | all | 稳定 | `dsh plugin --profile web add @hydra-dsh/plugin-intranet-wiki` |
| [`@hydra-dsh/plugin-notify`](packages/plugin-notify) | macOS 任务完成/出错系统通知：每轮 turn 结束弹通知，带状态与耗时 | macOS | 稳定 | `dsh plugin --profile web add @hydra-dsh/plugin-notify` |
| [`@hydra-dsh/plugin-intranet-settings-card`](packages/plugin-intranet-settings-card) | 内网凭据设置卡：在 Web 设置页 Plugins 标签页填写 INTRANET_* 凭据，值经 credentials 服务保存 | web | 实验 | `dsh plugin --profile web add @hydra-dsh/plugin-intranet-settings-card` |
| [`@hydra-dsh/plugin-hello`](packages/plugin-hello) | 模板插件：可配置问候语的 hydra_greet 工具，新插件从复制它开始 | all | 模板 | `dsh plugin --profile web add @hydra-dsh/plugin-hello` |
<!-- catalog:end -->

表格由 `pnpm gen:catalog` 从各包 package.json 生成，请勿手工编辑。

## 常用命令

```sh
dsh plugin --profile web add <包名>       # 安装
dsh plugin --profile web update <包名>    # 升级
dsh plugin --profile web remove <包名>    # 卸载
dsh --profile web --dump-config           # 不启动，检查生效的配置层
```

插件的安装/升级/卸载在 profile 重启后生效；配置覆盖写在 `~/.dsh/profiles/web/cordis.patch.yml`（热重载，无需重启）。完整说明见[用户手册](docs/user-guide.md)。

## 兼容表

dsh 处于 rc 阶段且无兼容承诺，本仓库每轮发布锚定一个实测的 dsh 版本：

| 本仓库 | 要求的 dsh |
|---|---|
| 0.1.x | `@deepseek-ai/dsh` 0.1.2-alpha.2 |

## 文档

- [用户手册](docs/user-guide.md) —— 安装、配置覆盖、热重载与重启边界、故障排查、源码安装
- [插件开发 Cookbook](docs/plugin-development-cookbook.md) —— 从想法到发布的完整流程
- [发布与维护](docs/release.md) —— 版本策略、发布 runbook、dsh 升级适配、退役流程
- [仓库开发规范](AGENTS.md) —— 纪律、命令与质量门（AI 与人共用）
