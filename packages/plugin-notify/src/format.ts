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
