/** Locale bundles for the intranet credentials card. */

/** Locale keys the card renders. */
export type IntranetSettingsLocaleKey =
  | 'title' | 'description'
  | 'save' | 'saving' | 'discard' | 'saveFailed'
  | 'configured' | 'unconfigured' | 'placeholder'
  | 'wikiBaseUrl' | 'wikiBaseUrlHint'
  | 'wikiToken' | 'wikiTokenHint'
  | 'gitlabBaseUrl' | 'gitlabBaseUrlHint'
  | 'gitlabToken' | 'gitlabTokenHint'

/** English copy. */
export const en: Record<IntranetSettingsLocaleKey, string> = {
  title: 'Intranet tools',
  description: 'Credentials for the intranet wiki and GitLab tools. Values are stored through the credentials service; they never appear in settings documents or responses.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'Some credentials were not stored. The remaining drafts are kept — try saving again.',
  configured: 'Configured',
  unconfigured: 'Not configured',
  placeholder: 'Enter a new value',
  wikiBaseUrl: 'Wiki base URL',
  wikiBaseUrlHint: 'Confluence-style API origin, for example https://wiki.example.com',
  wikiToken: 'Wiki token',
  wikiTokenHint: 'Bearer token the wiki tools authenticate with',
  gitlabBaseUrl: 'GitLab base URL',
  gitlabBaseUrlHint: 'GitLab API origin, for example https://gitlab.example.com',
  gitlabToken: 'GitLab token',
  gitlabTokenHint: 'Private token the analysis tool authenticates with',
}

/** Chinese copy. */
export const zh: Record<IntranetSettingsLocaleKey, string> = {
  title: '内网工具',
  description: '内网 Wiki 与 GitLab 工具的凭证。值经凭证服务存储,不会出现在设置文档或任何响应里。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃',
  saveFailed: '部分凭证未能存储,未保存的草稿已保留——请重试。',
  configured: '已配置',
  unconfigured: '未配置',
  placeholder: '输入新值',
  wikiBaseUrl: 'Wiki 地址',
  wikiBaseUrlHint: 'Confluence 风格 API 源,例如 https://wiki.example.com',
  wikiToken: 'Wiki 令牌',
  wikiTokenHint: 'Wiki 工具使用的 Bearer 令牌',
  gitlabBaseUrl: 'GitLab 地址',
  gitlabBaseUrlHint: 'GitLab API 源,例如 https://gitlab.example.com',
  gitlabToken: 'GitLab 令牌',
  gitlabTokenHint: '分析工具使用的私有令牌',
}
