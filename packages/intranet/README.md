# @hydra-dsh/intranet

内网能力全家桶（meta-bundle）：一次安装同时启用 [`plugin-intranet-wiki`](../plugin-intranet-wiki)（读取 + 审批门控写入）与 [`plugin-intranet-gitlab`](../plugin-intranet-gitlab)（只读代码分析），并固化两者搭配使用的正确姿势——wiki 写路径预设 `applyWriteApproval: ask`，凭据引用名全套对齐 `INTRANET_*`。

## 安装

```sh
dsh plugin --profile web add @hydra-dsh/intranet
```

重启 profile 生效。**与两个成员插件的独立安装互斥**（同装会导致配置行 id 重复）；只想要单件时直接装对应成员包。

## 内容

本包自身无任何运行时代码——实质是一层配置补丁，插入两行：

| 行 id | 插件 | 预设 |
|---|---|---|
| `intranet-tool-wiki` | `@hydra-dsh/plugin-intranet-wiki` | `applyWriteApproval: ask` |
| `intranet-tool-gitlab` | `@hydra-dsh/plugin-intranet-gitlab` | 全默认 |

## 凭据

装完后在 `~/.dsh/.credentials.yaml` 或环境变量里提供四个值：`INTRANET_WIKI_BASE_URL`、`INTRANET_WIKI_TOKEN`、`INTRANET_GITLAB_BASE_URL`、`INTRANET_GITLAB_TOKEN`。细节见各成员包 README 的凭据节。

## 配置

按行 id 在 profile 的 `cordis.patch.yml` 覆盖成员插件（整个 `config` 替换）；字段表见各成员包 README。临时停用某件：对应行 `disabled: true`。

## Model Experience

本包无自身模型面；生效后模型工具清单新增四个 `intranet_*` 工具（wiki 三个 + gitlab 一个），细节见成员包。

## 已知限制

- 升级本包即整体推进两个成员到一组经过共同测试的版本；需要更细的升级粒度时改用独立安装。
