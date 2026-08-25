# @hydra-dsh/plugin-intranet-gitlab

面向模型的内网 GitLab 只读代码分析工具：解析项目定位符，从需求线索发现相关代码，读取有界的生效范围，返回轻量影响分析。

## 安装

```sh
dsh plugin --profile web add @hydra-dsh/plugin-intranet-gitlab
```

重启 profile 生效。**与 [`@hydra-dsh/intranet`](../intranet) 全家桶互斥**（全家桶已含本插件，同装会导致配置行 id 重复）。

## 行为

注册一个模型可见工具 `intranet_gitlab_analyze_code_source`：入参给出 `projectLocator`（数字 id、项目名、namespace 路径或内网 GitLab URL），外加至少一个代码路径或需求线索（`moduleHints` / `routeHints` / `apiHints` / `uiTexts` / `changeDescription`）。流水线四阶段：定位符解析 → 线索驱动的范围发现（blob 搜索 + 路由/导入证据验证）→ 生效范围的有界并发读取 → 按文件静态提取，聚合为 API/路由/组件/服务/DTO 视图与推断副作用。发现阶段还会探测项目的 `CLAUDE.md` 与公司约定的模块定位指南并纳入 `guidanceFiles`。未形成可验证范围时返回 `analysis: null` 加警告，而不是猜测。

## 凭据

配置只携带**凭据引用名**，值在每次调用时从 credentials 服务或启动环境解析。默认引用名 `INTRANET_GITLAB_BASE_URL` / `INTRANET_GITLAB_TOKEN`——真实值放 `~/.dsh/.credentials.yaml` 或环境变量（含 `.env`）。

## 配置

在 profile 的 `cordis.patch.yml` 按 `id: intranet-tool-gitlab` 覆盖（整个 `config` 替换）。全部字段有默认值：

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrlEnv` / `tokenEnv` | `INTRANET_GITLAB_BASE_URL` / `INTRANET_GITLAB_TOKEN` | 凭据引用名 |
| `timeoutMs` | `60000` | 协作式工具超时预算 |
| `hintLimit` | `10` | 每个线索数组的条数上限 |
| `discovery.maxQueries` | `6` | 线索搜索的查询数上限 |
| `discovery.searchPerPage` / `discovery.searchMaxPages` | `20` / `2` | blob 搜索分页 |
| `discovery.maxCandidateFiles` / `discovery.maxDiscoveredPaths` | `24` / `30` | 候选/发现路径上限 |
| `read.maxFiles` | `60` | 读取文件数上限 |
| `read.maxFileChars` / `read.maxTotalChars` | `50000` / `180000` | 单文件/总字符预算 |
| `read.readConcurrency` | `6` | 读取并发 |

## Model Experience

一个模型可见工具；结果为美化 JSON，待执行卡片 `kind: 'search'` 以定位符命名。声明并发安全。

## 已知限制

- 只读——不提供任何 GitLab 写入能力。
- 范围发现依赖 GitLab 搜索 API 的行为与项目内的路由/导入证据；证据不足时宁可返回空分析加警告。
