# @hydra-dsh/plugin-intranet-wiki

面向模型的内网 Wiki 工具（Confluence 风格 REST 端点）：预算受控的页面读取，加两步式回写——执行步经人工审批，凭据值永不进配置。

## 安装

```sh
dsh plugin --profile web add @hydra-dsh/plugin-intranet-wiki
```

重启 profile 生效。**与 [`@hydra-dsh/intranet`](../intranet) 全家桶互斥**（全家桶已含本插件，同装会导致配置行 id 重复）。

## 行为

注册三个模型可见工具：

| 工具 | 作用 |
|---|---|
| `intranet_wiki_read_page` | 按 URL / 页面 id 读单页，或（用户明确要求时）广度优先读子孙页；在深度、页数、字符预算内把 storage HTML 转纯文本，`completeness` 报告完整度 |
| `intranet_wiki_prepare_write` | 回写的只读第一步：校验目标、渲染 Markdown 为 storage 格式、返回写入计划（含 `baseVersion` 与内容摘要），不改动 Wiki |
| `intranet_wiki_apply_write` | 写入本身：`create_child` 建子页 / `append_page` 追加；`baseVersion` 失配返回 `version_conflict` 而不写入。在 `applyWriteApproval: ask` 下每次调用经 `ctx.approval` 审批，无审批能力的组合里失败关闭 |

## 凭据

配置只携带**凭据引用名**，值在每次调用时从 credentials 服务或启动环境解析。默认引用名 `INTRANET_WIKI_BASE_URL` / `INTRANET_WIKI_TOKEN`——把真实值放进 `~/.dsh/.credentials.yaml` 或环境变量（含 `.env`），缺失时调用失败并点名未解析的引用。

## 配置

在 profile 的 `cordis.patch.yml` 按 `id: intranet-tool-wiki` 覆盖（整个 `config` 替换，保留字段要写全；`applyWriteApproval` 必填）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `applyWriteApproval` | **必填**（`ask` \| `allow`；本包 patch 与全家桶均预设 `ask`） | 写入执行步的审批策略 |
| `baseUrlEnv` / `tokenEnv` | `INTRANET_WIKI_BASE_URL` / `INTRANET_WIKI_TOKEN` | 凭据引用名 |
| `readTimeoutMs` / `writeTimeoutMs` | `60000` / `30000` | 协作式工具超时预算 |
| `read.defaultMaxChars` / `read.maxChars` | `60000` / `100000` | 单次调用默认/上限字符预算 |
| `read.totalMaxChars` | `150000` | 整次调用总字符预算 |
| `read.maxDepth` | `10` | 子孙读取最大深度 |
| `read.defaultMaxPages` / `read.maxPages` | `30` / `100` | 默认/上限页数 |
| `read.defaultMaxCharsPerPage` / `read.maxCharsPerPage` | `20000` / `60000` | 单页默认/上限字符 |

## Model Experience

三个工具进入模型工具清单；结果为美化 JSON。读取端预算模型可见并可在调用参数里收窄（被配置窗口收敛）。读取与准备步并发安全，执行步互斥；待审批卡片携带完整 `contentMarkdown`，审批者能看到将写入的确切内容。

## 已知限制

- 端点为 Confluence 风格 REST 专用，其他 wiki 系统不适用。
- `ask` 策略依赖组合具备审批能力（Web profile 自带）；纯无人值守组合中写入将失败关闭——这是有意的安全默认。
