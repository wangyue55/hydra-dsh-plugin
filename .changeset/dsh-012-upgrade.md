---
"@hydra-dsh/plugin-intranet-settings-card": patch
"@hydra-dsh/plugin-intranet-wiki": patch
"@hydra-dsh/plugin-intranet-gitlab": patch
"@hydra-dsh/intranet": patch
"@hydra-dsh/plugin-notify": patch
"@hydra-dsh/plugin-hello": patch
---

适配 dsh 0.1.2-alpha.2：依赖范围升级到 `^0.1.2-alpha.2`；settings-card 宿主半边改用 `settings.installSection`，浏览器半边迁移到 `dsh-client-store` 与 `remote.credentials`，移除已删除的 `dsh-client-runtime`；测试改用 `ToolCallId`。功能与配置不变，无需用户操作。
