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
  const args = ['-e', 'on run argv', '-e', script, '-e', 'end run', '--', request.body, request.title]
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
