# @hydra-dsh/plugin-hello

hydra-dsh-plugins 的模板插件：注册一个 `hydra_greet` 工具，用可配置的问候语向指定名字打招呼。新插件从复制本包开始。

## 安装

```sh
dsh plugin --profile web add @hydra-dsh/plugin-hello
```

重启该 profile 后生效（Bundle 增删改需要重启；普通 `cordis.patch.yml` 编辑走热重载）。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖（覆盖是整个 `config` 替换，不是深合并）：

```yaml
- id: hydra-hello
  config:
    greeting: 你好
```

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `greeting` | string | `Hello` | `hydra_greet` 工具使用的问候语 |

## Model Experience

注册一个模型可见工具 `hydra_greet`（一个必填 string 参数 `name`），结果为一行文本。无系统提示词贡献，无 KV cache 影响。
