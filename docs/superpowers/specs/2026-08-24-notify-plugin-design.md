# @hydra-dsh/plugin-notify 设计

日期：2026-08-24 · 状态：已批准（对话中逐项确认）

## 目的

dsh 的 agent 每结束一轮（`turn/end`）就发一条 macOS 系统通知，让用户离开屏幕时也知道任务跑完了或出错了。

## 已确认的决策

- **触发**：不做耗时阈值降噪（用户选择，放弃了阈值方案）；是否通知仅由 `reason.kind` 决定，见映射表。
- **内容**：状态 + 本轮耗时；`error` 时正文额外附错误消息首行（截断 80 字符）。耗时格式：小于 60s 显示 `42s`，其余显示 `3m05s`；起点缺失时正文省略耗时。
- **机制**：`osascript` 的 `display notification`，零外部依赖；放弃 terminal-notifier（分发摩擦）与 node-notifier（跨平台冗余）。
- **不通知的 reason**：`aborted`（用户亲手取消）、`interrupted`（崩溃恢复补写的历史标记，非实时）、`blocked`（前置钩子拒绝唤醒的内部路径）。

## 包结构

- `packages/plugin-notify`，包名 `@hydra-dsh/plugin-notify`，标准 Bundle（`dsh.bundle` 清单 + `cordis.patch.yml` 插入 `id: hydra-notify` 行），骨架复制自 `plugin-hello`。
- 函数插件具名导出：`name = 'hydra-notify'`、`Config`、`apply`；**无 `inject`**——只监听全局 `session/event`，不消费任何服务。
- peerDependencies：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-session`（事件与 reason 类型）。若 `ctx.on('session/event')` 的类型声明要求 `@deepseek-ai/dsh-agent`，将其一并加入 peer + dev。
- 纯函数模块（独立可测，不触 cordis）：
  - `formatNotification(reason, durationMs?)` → `{ title, body } | null`（null = 该 reason 不通知）
  - `buildOsascriptArgs({ title, body, sound })` → `string[]`（`on run argv` 参数化 AppleScript，文案经 argv 传入，无转义面）

## 数据流

1. `turn/start` → 闭包 `Map<sessionId, startMs>` 记 `Date.now()`。
2. `turn/end` → 从 Map 取起点算耗时（缺起点则正文省略耗时），`map.delete`。
3. `formatNotification` 按 `reason.kind` 产出文案（映射表见下），null 则跳过。
4. `execFile('osascript', argv)` fire-and-forget 投递；子进程短命，不注册 effect。
5. 监听器经 `ctx.on` 注册，插件卸载自动清理。

## reason 映射表

| `reason.kind` | 通知 |
|---|---|
| `completed` | ✅「dsh · 任务完成」+ 耗时 |
| `error` | ❌「dsh · 任务出错」+ 耗时 + 错误消息首行（≤80 字符） |
| `max-tokens` | ⚠️「dsh · 达到输出上限」+ 耗时 |
| `aborted` / `interrupted` / `blocked` | 不通知 |
| 其他（merge-extensible 新增变体） | 不通知（有注释说明的默认分支） |

## 配置

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `sound` | string | `''` | 空为静音；填 macOS 系统声音名（如 `Glass`）则通知带声 |

## 错误处理

- 非 `darwin` 平台：`apply` 时警告一次，不注册监听；README 标明 macOS-only。不设 package.json `os` 字段（避免 Linux profile 安装直接失败）。
- `osascript` 投递失败（如系统通知权限被拒）：首次警告，之后静默——避免每轮刷错误日志。
- 投递路径整体 try/catch：监听器内任何异常不得向事件分发抛出。

## 测试

- vitest 单测：导出契约（同模板）；`formatNotification` 覆盖全部 reason 分支、耗时缺失省略、错误首行截断；`buildOsascriptArgs` 含/不含 sound 两分支。
- 组合验证：dev profile 安装后 `--dump-config` 出现本包层。
- 真通知：dev profile 跑一轮任务，人工确认弹出（自动化不可行，README 记录验证步骤）。

## 文档与发布

- 包 README：安装命令、macOS-only 声明、配置表、映射表、Model Experience（无模型可见面：不注册工具/提示词，KV cache 无影响）。
- 根 README 插件目录表加行。
- 首发版本 0.1.0，changeset 走 minor。
