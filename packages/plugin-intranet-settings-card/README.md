# @hydra-dsh/plugin-intranet-settings-card

内网凭据设置卡：在 dsh Web 设置页的 **Plugins** 标签页渲染一张卡片，图形化填写四个 `INTRANET_*` 凭据——值经 credentials 服务保存（落 `~/.dsh/.credentials.yaml`），绝不进设置文档或配置文件。

## 安装

随 [`@hydra-dsh/intranet`](../intranet) 全家桶安装（推荐，卡片行已含在内）。单独安装本包不会自动激活——它不带独立配置层，需要你在 profile 的 `cordis.patch.yml` 手写插入行：

```yaml
- insert:
    - id: intranet-settings-card
      name: '@hydra-dsh/plugin-intranet-settings-card'
```

重启 profile 生效。仅 Web profile 有意义（`platform: web`）。

## 行为

- **Host 半边**：注册 `intranet` 设置命名空间，让 Plugins 标签页出现本卡片；配置只声明四个凭据引用名。
- **浏览器半边**：React 卡片 + 控制器，读写走 credentials 域 API；构建为宿主 module-table 的闭包工厂产物（`lib/client.js`），由 dsh 的 client-modules 服务按 `dsh.client` 清单发现并经 `/plugins/<包名>/client.js` 提供给浏览器。

## 配置

按 `id: intranet-settings-card` 覆盖（整个 `config` 替换）。四个字段都是**凭据引用名**，默认与两个内网工具的默认一致——若在工具配置里改了引用名，这里要写同名，卡片才编辑对的键：

| 字段 | 默认 |
|---|---|
| `wikiBaseUrlEnv` | `INTRANET_WIKI_BASE_URL` |
| `wikiTokenEnv` | `INTRANET_WIKI_TOKEN` |
| `gitlabBaseUrlEnv` | `INTRANET_GITLAB_BASE_URL` |
| `gitlabTokenEnv` | `INTRANET_GITLAB_TOKEN` |

## Model Experience

无模型可见面：不注册工具、不贡献提示词；纯 Web UI 能力。

## 已知限制

- 浏览器半边的外部依赖表（tsdown.config.ts 的 `CLIENT_EXTERNALS`）与 dsh `0.1.1-rc.2` 的平台 module-table 基线对齐；dsh 升级时需对照上游 `platform.ts` 核对，漂移会导致卡片在浏览器端加载失败。
- 卡片出现在 Plugins 标签页依赖宿主的 `client-ui-settings-plugins` 就位（Web profile 默认满足）。
