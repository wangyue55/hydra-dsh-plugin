# 用户手册

面向使用者：如何在自己的 dsh 里安装、配置和排查本仓库的插件。前提：已安装 [dsh CLI](https://www.npmjs.com/package/@deepseek-ai/dsh)（`npm install -g @deepseek-ai/dsh`，或用 `npx @deepseek-ai/dsh web` 免安装运行）。

## 安装 / 升级 / 卸载

```sh
dsh plugin --profile web add @hydra-dsh/plugin-hello
```

```sh
dsh plugin --profile web update @hydra-dsh/plugin-hello
```

```sh
dsh plugin --profile web remove @hydra-dsh/plugin-hello
```

`--profile web` 是 dsh 的默认 Web profile；其他 profile 换名字即可。命令会把包装进 `~/.dsh/profiles/<name>/` 并自动登记/移除对应的配置层。卸载不影响已保存的凭据（`~/.dsh/.credentials.yaml` 独立于插件存在），重装后无需重填。

## 生效边界：什么要重启，什么不用

| 操作 | 生效方式 |
|---|---|
| add / update / remove 插件 | **重启该 profile**——运行中的 dsh 保持它启动那一刻的插件集合 |
| 编辑 `cordis.patch.yml`（配置覆盖、disabled） | 热重载，运行中立即生效 |

没有 dsh 在跑时什么都不用做，下次启动自然带上变更。

## 配置覆盖

每个插件的可配置项见其 README 的配置表。覆盖写在 `~/.dsh/profiles/<name>/cordis.patch.yml`，按行 id 定位，**整个 `config` 替换**（不深合并——想保留的字段要一起写全）：

```yaml
- id: hydra-hello
  config:
    greeting: 你好
```

临时停用一个插件而不卸载：

```yaml
- id: hydra-hello
  disabled: true
```

## 验证与排查

```sh
dsh --profile web --dump-config
```

不启动进程、离线打印组合后的完整配置；每个插件的层以 `# == <包名>` 注释标出。常见问题：

- **装了但没生效**：多半是没重启 profile。先 `--dump-config` 确认层存在，再重启。
- **启动报错找不到模块**：若曾从本地目录安装（link 方式），确认那个目录仍存在且已构建；不再需要时 `remove` 掉。

## 从源码安装（尝鲜 / 内测）

npm 之外也支持 git 直装（monorepo 子目录用 pnpm 的 `path:` 选择器）：

```sh
dsh plugin --profile web add "github:<owner>/hydra-dsh-plugins#<commit>&path:/packages/plugin-hello"
```

git 装到的是源码，安装时要运行包的 `prepare` 构建脚本；pnpm ≥10 默认拒绝，并提示把包名加进 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`。**这一步等于授权在安装期、agent 沙箱之外执行该包的代码**：只安装信任的来源，并固定 commit。不想给这个授权就走 npm 安装——预构建产物，无需任何脚本放行。
