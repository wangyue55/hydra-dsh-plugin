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
