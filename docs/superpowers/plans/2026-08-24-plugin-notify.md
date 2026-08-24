# @hydra-dsh/plugin-notify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dsh 每结束一轮（`turn/end`）按 reason 发 macOS 系统通知（状态 + 耗时），零外部依赖，作为独立 Bundle 发布。

**Architecture:** 函数插件监听全局 `session/event`：`turn/start` 记事件时间，`turn/end` 用事件时间差算耗时，纯函数 `formatNotification` 产出文案（`aborted`/`interrupted`/`blocked` 返回 null 静默），`deliverNotification` 经参数化 AppleScript（`osascript` argv 传参，无转义面）投递。非 darwin 平台加载时警告一次并不注册监听；投递失败首次警告后静默。

**Tech Stack:** TypeScript 6（strict, NodeNext）、tsdown、vitest、Schemastery、`node:child_process` execFile。peer：`@deepseek-ai/cordis` + `@deepseek-ai/dsh-session`（已核实：`'session/event'` 的 cordis Events 合并与 `TurnEndReason`/`SessionId`/`SessionEvent` 均由 `@deepseek-ai/dsh-session` 根导出提供，不需要 dsh-agent）。

**Spec:** `docs/superpowers/specs/2026-08-24-notify-plugin-design.md`（已批准；文案、映射表、耗时格式以 spec 为准）

## Global Constraints

- 仓库：`/Users/wangyue-mac/projects/hydra-dsh-plugins`，pnpm workspace；所有命令在仓库根运行。
- 包名 `@hydra-dsh/plugin-notify`，目录 `packages/plugin-notify`，版本 `0.1.0`，ESM（`"type": "module"`），engines `"node": "^22.19.0 || >=24.0.0"`。
- 函数插件具名导出 `name` / `Config` / `apply`，**无 default export，无 `inject`**。
- 依赖三分法：`@deepseek-ai/cordis@^4.0.1` 与 `@deepseek-ai/dsh-session@^0.1.1-rc.2` 仅进 peerDependencies（devDependencies 重复一份供本地类型检查）；`@deepseek-ai/schemastery@^3.18.1` 进 dependencies；`tsdown@^0.22.2` + `typescript@^6.0.3` 进包内 devDependencies（git 安装的 `prepare` 需独立可运行）。
- 对 `@deepseek-ai/dsh-session` 只允许 **type-only import**（运行时值全部来自 cordis 回调参数），保证运行时解析零额外面。
- **CI 在 ubuntu 上跑测试**：所有需要走 darwin 分支的测试必须用 `withPlatform('darwin', ...)` 显式覆盖 `process.platform`。
- 通知文案、reason 映射、耗时格式（`42s` / `3m05s`、error 首行 ≤80 字符加 `…`）逐字以 spec 映射表为准。
- 每个提交信息末尾带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`，提交用 `git -c core.hooksPath=/dev/null commit`。

---

### Task 1: 包骨架 + 导出契约

**Files:**
- Create: `packages/plugin-notify/package.json`
- Create: `packages/plugin-notify/tsconfig.json`
- Create: `packages/plugin-notify/tsdown.config.ts`
- Create: `packages/plugin-notify/cordis.patch.yml`
- Create: `packages/plugin-notify/src/index.ts`（最小实现：导出契约 + 平台守卫，监听留给 Task 4）
- Test: `packages/plugin-notify/tests/plugin.test.ts`

**Interfaces:**
- Consumes: 无（首任务）。
- Produces: `name = 'hydra-notify'`；`interface Config { sound: string }`；`const Config: Schema<Config>`（default `{ sound: '' }`）；`function apply(ctx: Context, config: Config): void`。Task 4 整体重写 `apply`，其余导出后续任务不再动。

- [ ] **Step 1: 写失败的契约测试**

创建 `packages/plugin-notify/tests/plugin.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

describe('@hydra-dsh/plugin-notify exports', () => {
  it('exports the function-plugin contract (no default, no inject)', () => {
    expect(plugin.name).toBe('hydra-notify')
    expect(typeof plugin.apply).toBe('function')
    expect(Object.hasOwn(plugin, 'default')).toBe(false)
    expect(Object.hasOwn(plugin, 'inject')).toBe(false)
  })

  it('fills config defaults through the schema', () => {
    expect(plugin.Config()).toEqual({ sound: '' })
  })

  it('rejects a mistyped config at load time', () => {
    expect(() => plugin.Config({ sound: 42 as never })).toThrow()
  })
})
```

- [ ] **Step 2: 建包清单与构建配置**

创建 `packages/plugin-notify/package.json`：

```json
{
  "name": "@hydra-dsh/plugin-notify",
  "version": "0.1.0",
  "description": "macOS turn-end notifications for DeepSeek Harness: status + duration per finished turn",
  "type": "module",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/YOUR-GITHUB-USER/hydra-dsh-plugins.git",
    "directory": "packages/plugin-notify"
  },
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "lib",
    "cordis.patch.yml"
  ],
  "publishConfig": {
    "access": "public"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "engines": {
    "node": "^22.19.0 || >=24.0.0"
  },
  "scripts": {
    "build": "tsdown",
    "prepare": "tsdown",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-session": "^0.1.1-rc.2"
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "^3.18.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-session": "^0.1.1-rc.2",
    "tsdown": "^0.22.2",
    "typescript": "^6.0.3"
  }
}
```

创建 `packages/plugin-notify/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "tests", "tsdown.config.ts"]
}
```

创建 `packages/plugin-notify/tsdown.config.ts`：

```ts
import { defineConfig } from 'tsdown'

// 自包含构建：git 安装通过 `prepare` 在用户机器上运行本配置，
// 只依赖本包自己的 devDependencies，不假设 monorepo 上下文。
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  outDir: 'lib',
  dts: true,
  clean: true,
  // "type": "module" 下产出 .js/.d.ts（默认为 .mjs/.d.mts），对齐 main/types 字段。
  fixedExtension: false,
})
```

创建 `packages/plugin-notify/cordis.patch.yml`：

```yaml
# @hydra-dsh/plugin-notify 的 Bundle 层：profile 安装本包后此行生效。
# 用户可在自己的 cordis.patch.yml 里按 id 覆盖 config 或 disabled 此行。
- insert:
    - id: hydra-notify
      name: '@hydra-dsh/plugin-notify'
      config:
        sound: ''
```

- [ ] **Step 3: 写最小 `src/index.ts`**

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'hydra-notify'

export interface Config {
  /** macOS 系统声音名（如 'Glass'）；空字符串为静音。 */
  sound: string
}

export const Config: Schema<Config> = Schema.object({
  sound: Schema.string().default(''),
})

/**
 * macOS-only：非 darwin 平台警告一次并保持完全不活动。
 * @param ctx - 插件上下文。
 * @param config - 校验后的配置。
 */
export function apply(ctx: Context, config: Config) {
  if (process.platform !== 'darwin') {
    console.warn(`[hydra-notify] macOS-only: notifications disabled on ${process.platform}`)
    return
  }
  void ctx
  void config
}
```

- [ ] **Step 4: 安装 workspace 链接并跑测试**

```bash
pnpm install
pnpm --filter @hydra-dsh/plugin-notify test
```

预期：`pnpm install` 解析新包依赖并经 `prepare` 构建出 `lib/`；vitest 3 个用例全 PASS。

- [ ] **Step 5: 类型检查 + 构建**

```bash
pnpm --filter @hydra-dsh/plugin-notify typecheck
pnpm --filter @hydra-dsh/plugin-notify build
```

预期：均零错误；`packages/plugin-notify/lib/` 含 `index.js` 与 `index.d.ts`。

- [ ] **Step 6: 提交**

```bash
git add packages/plugin-notify pnpm-lock.yaml
git -c core.hooksPath=/dev/null commit -m "feat(notify): package scaffold with export contract

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 文案纯函数 `formatNotification`

**Files:**
- Create: `packages/plugin-notify/src/format.ts`
- Test: `packages/plugin-notify/tests/format.test.ts`

**Interfaces:**
- Consumes: `TurnEndReason`（type-only，`@deepseek-ai/dsh-session`；判别字段 `kind`，`error` 变体带 `error.message: string`）。
- Produces: `interface NotificationText { title: string; body: string }`；`formatDuration(ms: number): string`；`formatNotification(reason: TurnEndReason, durationMs?: number): NotificationText | null`。Task 4 消费 `formatNotification`。

- [ ] **Step 1: 写失败的测试**

创建 `packages/plugin-notify/tests/format.test.ts`：

```ts
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { formatDuration, formatNotification } from '../src/format.ts'

describe('formatDuration', () => {
  it('renders sub-minute as seconds', () => {
    expect(formatDuration(42_000)).toBe('42s')
  })
  it('rounds up across the minute boundary', () => {
    expect(formatDuration(59_999)).toBe('1m00s')
  })
  it('zero-pads seconds past a minute', () => {
    expect(formatDuration(185_000)).toBe('3m05s')
  })
})

describe('formatNotification', () => {
  it('formats completed with duration', () => {
    expect(formatNotification({ kind: 'completed' }, 42_000)).toEqual({
      title: '✅ dsh · 任务完成',
      body: '耗时 42s',
    })
  })

  it('omits duration when the start was never seen', () => {
    expect(formatNotification({ kind: 'completed' })).toEqual({
      title: '✅ dsh · 任务完成',
      body: '',
    })
  })

  it('formats max-tokens', () => {
    expect(formatNotification({ kind: 'max-tokens' }, 42_000)).toEqual({
      title: '⚠️ dsh · 达到输出上限',
      body: '耗时 42s',
    })
  })

  it('appends the first error line, clipped to 80 chars', () => {
    const message = `${'x'.repeat(90)}\nsecond line`
    const reason = { kind: 'error', error: { message, code: 'UNKNOWN' } } as TurnEndReason
    expect(formatNotification(reason, 42_000)).toEqual({
      title: '❌ dsh · 任务出错',
      body: `耗时 42s · ${'x'.repeat(80)}…`,
    })
  })

  it('uses the error line alone when duration is unknown', () => {
    const reason = { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } as TurnEndReason
    expect(formatNotification(reason)).toEqual({
      title: '❌ dsh · 任务出错',
      body: 'boom',
    })
  })

  it.each(['aborted', 'interrupted', 'blocked', 'some-future-kind'])(
    'stays silent for %s',
    (kind) => {
      expect(formatNotification({ kind } as never)).toBeNull()
    },
  )
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @hydra-dsh/plugin-notify exec vitest run tests/format.test.ts
```

预期：FAIL，`Cannot find module '../src/format.ts'`（或等价的解析错误）。

- [ ] **Step 3: 写实现**

创建 `packages/plugin-notify/src/format.ts`：

```ts
import type { TurnEndReason } from '@deepseek-ai/dsh-session'

/** 一条系统通知的文案。 */
export interface NotificationText {
  title: string
  body: string
}

/**
 * 人读耗时：不足一分钟显示 `42s`，否则 `3m05s`（秒两位补零）。
 * @param ms - 毫秒时长。
 * @returns 格式化文本。
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m${String(seconds).padStart(2, '0')}s`
}

/**
 * 把 turn 结束原因映射为通知文案；返回 null 表示该结束不通知。
 * @param reason - `turn/end` 事件的结束原因。
 * @param durationMs - 本轮耗时；起点缺失时省略。
 * @returns 文案，或 null（aborted / interrupted / blocked 及未知变体静默）。
 */
export function formatNotification(reason: TurnEndReason, durationMs?: number): NotificationText | null {
  const duration = durationMs === undefined ? '' : `耗时 ${formatDuration(durationMs)}`
  switch (reason.kind) {
    case 'completed':
      return { title: '✅ dsh · 任务完成', body: duration }
    case 'max-tokens':
      return { title: '⚠️ dsh · 达到输出上限', body: duration }
    case 'error': {
      const firstLine = reason.error.message.split('\n', 1)[0] ?? ''
      const clipped = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine
      return { title: '❌ dsh · 任务出错', body: duration === '' ? clipped : `${duration} · ${clipped}` }
    }
    default:
      // TurnEndReasonMap 是 merge-extensible 联合：aborted（用户亲手取消）、
      // interrupted（崩溃恢复补写）、blocked（唤醒被拒）以及未来新增变体一律静默。
      return null
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @hydra-dsh/plugin-notify exec vitest run tests/format.test.ts
```

预期：12 个用例全 PASS（formatDuration 3 + formatNotification 5 + it.each 静默分支 4）。

- [ ] **Step 5: 提交**

```bash
git add packages/plugin-notify/src/format.ts packages/plugin-notify/tests/format.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(notify): notification text formatting

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: osascript 投递 `buildOsascriptArgs` / `deliverNotification`

**Files:**
- Create: `packages/plugin-notify/src/osascript.ts`
- Test: `packages/plugin-notify/tests/osascript.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `NotificationText`（仅字段结构，本文件自定参数类型，不 import）。
- Produces: `interface NotificationRequest { title: string; body: string; sound: string }`；`buildOsascriptArgs(request: NotificationRequest): string[]`；`deliverNotification(request: NotificationRequest): Promise<void>`（execFile 失败时 reject）。Task 4 消费 `deliverNotification`。

- [ ] **Step 1: 写失败的测试**

创建 `packages/plugin-notify/tests/osascript.test.ts`（只测纯函数 `buildOsascriptArgs`；`deliverNotification` 是 execFile 的一行包装，由 Task 5 的真机验证覆盖）：

```ts
import { describe, expect, it } from 'vitest'
import { buildOsascriptArgs } from '../src/osascript.ts'

describe('buildOsascriptArgs', () => {
  it('builds a parameterized silent notification', () => {
    expect(buildOsascriptArgs({ title: 'T', body: 'B', sound: '' })).toEqual([
      '-e', 'on run argv',
      '-e', 'display notification (item 1 of argv) with title (item 2 of argv)',
      '-e', 'end run',
      'B', 'T',
    ])
  })

  it('appends the sound name when configured', () => {
    expect(buildOsascriptArgs({ title: 'T', body: 'B', sound: 'Glass' })).toEqual([
      '-e', 'on run argv',
      '-e', 'display notification (item 1 of argv) with title (item 2 of argv) sound name (item 3 of argv)',
      '-e', 'end run',
      'B', 'T', 'Glass',
    ])
  })

  it('passes hostile copy verbatim as argv, never into the script source', () => {
    const args = buildOsascriptArgs({ title: '"t" & (do shell script "true")', body: 'a\nb"', sound: '' })
    expect(args.slice(0, 6)).toEqual([
      '-e', 'on run argv',
      '-e', 'display notification (item 1 of argv) with title (item 2 of argv)',
      '-e', 'end run',
    ])
    expect(args.slice(6)).toEqual(['a\nb"', '"t" & (do shell script "true")'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @hydra-dsh/plugin-notify exec vitest run tests/osascript.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 写实现**

创建 `packages/plugin-notify/src/osascript.ts`：

```ts
import { execFile } from 'node:child_process'

/** 一次通知投递请求；`sound` 为空表示静音。 */
export interface NotificationRequest {
  title: string
  body: string
  sound: string
}

/**
 * 组装参数化 AppleScript 的 osascript argv：文案全部经 argv 传入
 * （item N of argv），脚本源码固定，因此没有 AppleScript 注入或转义面。
 * @param request - 通知文案与声音。
 * @returns 传给 execFile('osascript', ...) 的参数数组。
 */
export function buildOsascriptArgs(request: NotificationRequest): string[] {
  const script = request.sound === ''
    ? 'display notification (item 1 of argv) with title (item 2 of argv)'
    : 'display notification (item 1 of argv) with title (item 2 of argv) sound name (item 3 of argv)'
  const args = ['-e', 'on run argv', '-e', script, '-e', 'end run', request.body, request.title]
  if (request.sound !== '') args.push(request.sound)
  return args
}

/**
 * 发一条 macOS 系统通知；osascript 退出非零或无法启动时 reject。
 * @param request - 通知文案与声音。
 * @returns 投递完成的 promise。
 */
export function deliverNotification(request: NotificationRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('osascript', buildOsascriptArgs(request), (error) => {
      if (error !== null) reject(error)
      else resolve()
    })
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @hydra-dsh/plugin-notify exec vitest run tests/osascript.test.ts
```

预期：3 个用例全 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/plugin-notify/src/osascript.ts packages/plugin-notify/tests/osascript.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(notify): parameterized osascript delivery

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `apply` 监听接线

**Files:**
- Modify: `packages/plugin-notify/src/index.ts`（整体替换为下述内容）
- Test: `packages/plugin-notify/tests/apply.test.ts`

**Interfaces:**
- Consumes: Task 2 `formatNotification(reason, durationMs?)`；Task 3 `deliverNotification({ title, body, sound })`；`@deepseek-ai/dsh-session` 的 `SessionId`（type-only；`'session/event'` 的 Events 合并随之生效）。
- Produces: 最终形态的 `apply(ctx, config)`；无新导出。

- [ ] **Step 1: 写失败的测试**

创建 `packages/plugin-notify/tests/apply.test.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliverNotification } from '../src/osascript.ts'
import { Config, apply } from '../src/index.ts'

vi.mock('../src/osascript.ts', () => ({
  deliverNotification: vi.fn(() => Promise.resolve()),
}))

const deliverMock = vi.mocked(deliverNotification)

type Listener = (session: unknown, event: unknown) => void

/** 捕获 ctx.on 注册的假上下文；只实现本插件用到的面。 */
function mount(config?: { sound: string }) {
  const listeners = new Map<string, Listener>()
  const ctx = {
    on: (name: string, listener: Listener) => {
      listeners.set(name, listener)
    },
  }
  apply(ctx as unknown as Context, Config(config))
  return listeners
}

function withPlatform(platform: string, run: () => void) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    run()
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
}

const session = { id: 'session-1' }

function turnStart(time: number) {
  return { type: 'turn/start', seq: 1, time, data: { turn: 1 } }
}

function turnEnd(time: number, reason: unknown) {
  return { type: 'turn/end', seq: 2, time, data: { turn: 1, reason } }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('apply', () => {
  it('registers nothing and warns once off macOS', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    withPlatform('linux', () => {
      const listeners = mount()
      expect(listeners.size).toBe(0)
    })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('notifies a completed turn with event-time duration and cleans the start map', () => {
    withPlatform('darwin', () => {
      const listeners = mount()
      const listener = listeners.get('session/event')!
      listener(session, turnStart(1_000))
      listener(session, turnEnd(43_000, { kind: 'completed' }))
      expect(deliverMock).toHaveBeenCalledWith({ title: '✅ dsh · 任务完成', body: '耗时 42s', sound: '' })
      // 起点已清除：同会话再来一个 turn/end，耗时未知，正文为空。
      listener(session, turnEnd(99_000, { kind: 'completed' }))
      expect(deliverMock).toHaveBeenLastCalledWith({ title: '✅ dsh · 任务完成', body: '', sound: '' })
    })
  })

  it('stays silent for aborted turns', () => {
    withPlatform('darwin', () => {
      const listeners = mount()
      const listener = listeners.get('session/event')!
      listener(session, turnStart(1_000))
      listener(session, turnEnd(2_000, { kind: 'aborted', reason: { kind: 'user' } }))
      expect(deliverMock).not.toHaveBeenCalled()
    })
  })

  it('threads the configured sound through', () => {
    withPlatform('darwin', () => {
      const listeners = mount({ sound: 'Glass' })
      listeners.get('session/event')!(session, turnEnd(2_000, { kind: 'completed' }))
      expect(deliverMock).toHaveBeenCalledWith({ title: '✅ dsh · 任务完成', body: '', sound: 'Glass' })
    })
  })

  it('warns on the first delivery failure only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    deliverMock.mockRejectedValue(new Error('denied'))
    withPlatform('darwin', () => {
      const listeners = mount()
      const listener = listeners.get('session/event')!
      listener(session, turnEnd(2_000, { kind: 'completed' }))
      listener(session, turnEnd(3_000, { kind: 'completed' }))
    })
    await vi.waitFor(() => {
      expect(deliverMock).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenCalledTimes(1)
    })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @hydra-dsh/plugin-notify exec vitest run tests/apply.test.ts
```

预期：FAIL——darwin 分支的用例失败于 `listeners.get('session/event')` 为 undefined（Task 1 的 apply 还未注册监听）。

- [ ] **Step 3: 整体替换 `src/index.ts`**

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import Schema from '@deepseek-ai/schemastery'
import { formatNotification } from './format.ts'
import { deliverNotification } from './osascript.ts'

export const name = 'hydra-notify'

export interface Config {
  /** macOS 系统声音名（如 'Glass'）；空字符串为静音。 */
  sound: string
}

export const Config: Schema<Config> = Schema.object({
  sound: Schema.string().default(''),
})

/**
 * 监听全局 `session/event`：`turn/start` 记事件时间，`turn/end` 按 reason
 * 发 macOS 系统通知（状态 + 事件时间差算出的耗时）。macOS-only：非 darwin
 * 平台警告一次并保持完全不活动。投递失败首次警告，其后静默。
 * @param ctx - 插件上下文；监听经 ctx.on 注册，卸载自动清理。
 * @param config - 校验后的配置。
 */
export function apply(ctx: Context, config: Config) {
  if (process.platform !== 'darwin') {
    console.warn(`[hydra-notify] macOS-only: notifications disabled on ${process.platform}`)
    return
  }
  const turnStarts = new Map<SessionId, number>()
  let deliveryFailureWarned = false
  const warnOnce = (error: unknown) => {
    if (deliveryFailureWarned) return
    deliveryFailureWarned = true
    console.warn('[hydra-notify] notification delivery failed (further failures stay silent):', error)
  }
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      turnStarts.set(session.id, event.time)
      return
    }
    if (event.type !== 'turn/end') return
    const startTime = turnStarts.get(session.id)
    turnStarts.delete(session.id)
    // 投递路径整体兜底：任何异常走同一警告，绝不向事件分发抛出。
    try {
      const text = formatNotification(event.data.reason, startTime === undefined ? undefined : event.time - startTime)
      if (text === null) return
      deliverNotification({ ...text, sound: config.sound }).catch(warnOnce)
    } catch (error: unknown) {
      warnOnce(error)
    }
  })
}
```

- [ ] **Step 4: 跑全部测试与类型检查确认通过**

```bash
pnpm --filter @hydra-dsh/plugin-notify test
pnpm --filter @hydra-dsh/plugin-notify typecheck
```

预期：apply 5 例 + format 12 例 + osascript 3 例 + 契约 3 例共 23 例全 PASS；tsc 零错误（`ctx.on('session/event', ...)` 的类型来自 dsh-session 的 Events 合并，type-only import 已足够）。

- [ ] **Step 5: 提交**

```bash
git add packages/plugin-notify/src/index.ts packages/plugin-notify/tests/apply.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(notify): turn/end listener wiring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 文档、组合验证、changeset

**Files:**
- Create: `packages/plugin-notify/README.md`
- Modify: `README.md`（插件目录表加一行）
- Create: `.changeset/plugin-notify-initial.md`

**Interfaces:**
- Consumes: Task 1–4 的成品包。
- Produces: 可发布状态（文档齐、层激活验证过、changeset 就绪）。

- [ ] **Step 1: 写包 README**

创建 `packages/plugin-notify/README.md`：

````markdown
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
````

- [ ] **Step 2: 根 README 目录表加行**

在 `README.md` 的插件目录表 `plugin-hello` 行后追加：

```markdown
| [`@hydra-dsh/plugin-notify`](packages/plugin-notify) | macOS 任务完成/出错系统通知（每轮 turn 结束，状态 + 耗时） | `dsh plugin --profile web add @hydra-dsh/plugin-notify` |
```

- [ ] **Step 3: 全仓检查**

```bash
pnpm typecheck
pnpm test
pnpm build
```

预期：两个包全部零错误、全部用例 PASS、`lib/` 产物齐全。

- [ ] **Step 4: 沙盒组合验证（层激活）**

```bash
export DSH_HOME=/private/tmp/claude-501/-Users-wangyue-mac-projects-deepseek-harness/68d4696d-88ed-4929-bc69-d876943941af/scratchpad/dsh-home
dsh plugin --profile hydra-dev add /Users/wangyue-mac/projects/hydra-dsh-plugins/packages/plugin-notify
dsh --profile hydra-dev --dump-config | grep -A5 "== @hydra-dsh/plugin-notify"
```

预期输出包含：

```
# == @hydra-dsh/plugin-notify
- id: hydra-notify
  name: '@hydra-dsh/plugin-notify'
  config:
    sound: ''
```

- [ ] **Step 5: 真通知验证（有 DEEPSEEK_API_KEY 时）**

dsh 源码仓根目录的 `.env` 若有 key，则把插件装进沙盒 headless profile 跑一轮真任务，通知应弹出：

```bash
export DSH_HOME=/private/tmp/claude-501/-Users-wangyue-mac-projects-deepseek-harness/68d4696d-88ed-4929-bc69-d876943941af/scratchpad/dsh-home
dsh plugin --profile headless add /Users/wangyue-mac/projects/hydra-dsh-plugins/packages/plugin-notify
env $(grep -E '^DEEPSEEK_API_KEY=' /Users/wangyue-mac/projects/deepseek-harness/.env) dsh --profile headless "Reply with exactly one word: ok"
```

预期：stdout 打出模型回复，同时 macOS 弹出「✅ dsh · 任务完成」通知（首次可能先弹权限询问）。无 key 则跳过本步，在 PR/提交说明里注明"真通知待人工验证"。

- [ ] **Step 6: 写 changeset**

创建 `.changeset/plugin-notify-initial.md`：

```markdown
---
"@hydra-dsh/plugin-notify": minor
---

首发：dsh 每轮 turn 结束发 macOS 系统通知（completed/error/max-tokens 带状态与耗时；aborted/interrupted/blocked 静默；零外部依赖 osascript 投递）。
```

- [ ] **Step 7: 提交**

```bash
git add packages/plugin-notify/README.md README.md .changeset/plugin-notify-initial.md
git -c core.hooksPath=/dev/null commit -m "docs(notify): README, catalog row, changeset

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
