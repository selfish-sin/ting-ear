import { useCallback, useEffect, useRef } from 'react'

/**
 * 卸载安全的 setTimeout。
 *
 * 组件卸载后回调不再执行（避免对已卸载组件 setState），
 * 同时尽力清理尚未触发的定时器。
 *
 * 返回一个 stable 的 set 函数，用法与 window.setTimeout 一致，
 * 但无需手动 clearTimeout —— 卸载时统一清理。
 *
 * 注意：这**不改变**回调的触发时机，只在「组件已卸载」时跳过。
 * 因此不会引入新的竞态，只是消除卸载后的副作用泄漏。
 */
export function useSafeTimeout(): (handler: () => void, delay: number) => void {
  const mountedRef = useRef(true)
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  useEffect(() => {
    mountedRef.current = true
    const timers = timersRef
    return () => {
      mountedRef.current = false
      // 卸载时清理所有未触发的定时器
      timers.current.forEach((id) => clearTimeout(id))
      timers.current.clear()
    }
  }, [])

  return useCallback((handler: () => void, delay: number) => {
    const id = setTimeout(() => {
      // 触发时从集合移除（已执行）
      timersRef.current.delete(id)
      // 组件已卸载则跳过副作用
      if (!mountedRef.current) return
      handler()
    }, delay)
    timersRef.current.add(id)
  }, [])
}
