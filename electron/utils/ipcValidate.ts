/** 轻量 IPC 入参校验（不引入 zod，避免依赖膨胀） */

export function isNonEmptyString(value: unknown, maxLen = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLen
}

export function isBookId(value: unknown): value is string {
  // uuid 或历史 id
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\\/]/.test(value)
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function asPartialRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** 设置对象：至少是 plain object，禁止数组/null */
export function isSettingsPartial(value: unknown): value is Record<string, unknown> {
  return asPartialRecord(value) !== null
}
