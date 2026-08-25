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
