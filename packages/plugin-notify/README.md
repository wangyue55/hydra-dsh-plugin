# @hydra-dsh/plugin-notify

dsh 每结束一轮（`turn/end`）发一条 macOS 系统通知：状态 + 本轮耗时，让你离开屏幕也知道任务跑完了或出错了。零外部依赖（系统自带 `osascript`）。**macOS-only**：其他平台加载时警告一次并保持不活动。

## 安装

```sh
dsh plugin --profile web add @hydra-dsh/plugin-notify
```

重启该 profile 后生效（Bundle 增删改需要重启）。首次弹通知时 macOS 可能询问"脚本编辑器"的通知权限，允许即可。

## 通知规则

| turn 结束原因 | 通知 |
|---|---|
| `completed` | ✅「dsh · 任务完成」+ 耗时 |
| `error` | ❌「dsh · 任务出错」+ 耗时 + 错误首行（≤80 字符） |
| `max-tokens` | ⚠️「dsh · 达到输出上限」+ 耗时 |
| `aborted` / `interrupted` / `blocked` | 不通知（亲手取消、崩溃恢复标记、内部拒绝路径） |

耗时来自会话日志的事件时间差，格式 `42s` / `3m05s`。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖（整个 `config` 替换）：

```yaml
- id: hydra-notify
  config:
    sound: Glass
```

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `sound` | string | `''` | 空为静音；填 macOS 系统声音名（如 `Glass`、`Ping`）则通知带声 |

## Model Experience

无模型可见面：不注册工具、不贡献提示词，对 KV cache 无影响。

## 已知限制

- 通知图标是"脚本编辑器"（osascript 的归属），不可定制、点击无跳转；要更漂亮的通知得换 terminal-notifier 类方案，当前按零依赖取舍。
- 投递失败（如通知权限被拒）只在首次警告，其后静默。
