/**
 * 统一时间格式化工具。
 *
 * 清洗编辑记录、收听历史等位置都应调用这里，保证显示格式一致：
 * - 记录列表：YYYY-MM-DD HH:MM:SS（带秒，便于区分同一次处理的多次记录）
 * - 收听历史卡片：HH:MM:SS
 */

const pad = (n: number): string => String(n).padStart(2, '0')

/** YYYY-MM-DD HH:MM:SS */
export function formatFullTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`
}

/** HH:MM:SS */
export function formatHMS(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (isNaN(d.getTime())) return ''
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
