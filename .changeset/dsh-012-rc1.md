---
"@hydra-dsh/plugin-intranet-settings-card": patch
"@hydra-dsh/plugin-intranet-wiki": patch
"@hydra-dsh/plugin-intranet-gitlab": patch
"@hydra-dsh/intranet": patch
"@hydra-dsh/plugin-hello": patch
---

版本锚点升到 dsh 0.1.2-rc.1：依赖范围由 `^0.1.2-alpha.2` 改为 `^0.1.2-rc.1`。上游在此区间只改了内部实现（会话事件快照 API、存储格式 v2、各包移除空的 invariant 伴生模块），插件用到的类型与服务面未变；浏览器端平台基线经对照上游 `platform.ts` 核对无变化。另修正 settings-card 的 `@deepseek-ai/dsh-settings`：由 dependencies 移入 peerDependencies + devDependencies，避免安装时在插件自己的 node_modules 里多装一份宿主包。功能与配置不变，无需用户操作。
