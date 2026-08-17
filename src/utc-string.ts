/**
 * 将给定时刻格式化为系统本地时间字符串（如 "2026-08-15 11:04:05"）。
 * 纯函数，零依赖，可单测；client 半的时钟组件同样使用本函数。
 */
export function formatLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
  )
}
