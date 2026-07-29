/**
 * 加载遮罩「撑住」卡顿的核心：
 * 数据 Promise 结束 ≠ 界面可用。React 提交、布局、绘制往往在之后几帧。
 * 遮罩必须盖到这些主线程工作做完，再消失。
 */

/** 等待若干次 requestAnimationFrame（浏览器绘制周期） */
export function waitAnimationFrames(count = 2): Promise<void> {
  if (count <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    let left = count
    const tick = () => {
      left -= 1
      if (left <= 0) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

export function waitMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface UiSettleOptions {
  /** 遮罩最短展示时间（ms），避免一闪而过且给重渲染留窗口。默认 600 */
  minMs?: number
  /** 连续 rAF 次数，默认 3 */
  frames?: number
  /** 是否插入 macrotask 让 React 有机会 commit，默认 true */
  yieldMacrotask?: boolean
  /** 若传入，从该时间点起算 minMs（performance.now()） */
  startedAt?: number
}

/**
 * 等到：多帧绘制 + 一次事件循环让步 + 最短展示时长。
 * 在 setState / 切换大视图之后调用，再关掉 LoadingOverlay。
 */
export async function waitUntilUiSettled(options: UiSettleOptions = {}): Promise<void> {
  const minMs = options.minMs ?? 600
  const frames = options.frames ?? 3
  const yieldMacrotask = options.yieldMacrotask !== false
  const startedAt = options.startedAt ?? performance.now()

  // 1) 先让出当前栈，让 React 开始调度更新
  if (yieldMacrotask) {
    await waitMs(0)
  }

  // 2) 等几帧：commit → layout → paint 多半落在这些帧里
  await waitAnimationFrames(frames)

  // 3) 再让一次 macrotask + 一帧，兜住大列表二次布局
  if (yieldMacrotask) {
    await waitMs(16)
    await waitAnimationFrames(1)
  }

  // 4) 保证最短遮罩时间（用户体感「缓冲完了再进来」）
  const elapsed = performance.now() - startedAt
  if (elapsed < minMs) {
    await waitMs(minMs - elapsed)
  }

  // 5) 最后一帧：确保最终画面在遮罩下画完
  await waitAnimationFrames(1)
}

/**
 * 执行重任务，期间调用方应保持 loading 可见；
 * 任务结束后自动 waitUntilUiSettled。
 */
export async function runWithUiSettle<T>(
  work: () => Promise<T> | T,
  settle: UiSettleOptions = {}
): Promise<T> {
  const startedAt = settle.startedAt ?? performance.now()
  const result = await work()
  await waitUntilUiSettled({ ...settle, startedAt })
  return result
}

export interface ReaderReadyOptions extends UiSettleOptions {
  /** 最长等待阅读器挂载，默认 10000ms */
  timeoutMs?: number
  /** 滚动/正文容器选择器 */
  selector?: string
}

/**
 * 等真实阅读器首屏就绪（不是 loading 占位页）。
 * 条件：存在可滚动正文容器且 clientHeight>0，再补几帧让虚拟列表量高。
 */
export async function waitForReaderReady(options: ReaderReadyOptions = {}): Promise<void> {
  const minMs = options.minMs ?? 500
  const frames = options.frames ?? 3
  const timeoutMs = options.timeoutMs ?? 10000
  const selector =
    options.selector ?? '[data-content-cards], [data-reader-ready], [data-sentence-list]'
  const startedAt = options.startedAt ?? performance.now()

  if (options.yieldMacrotask !== false) {
    await waitMs(0)
  }
  await waitAnimationFrames(1)

  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    const el = document.querySelector(selector) as HTMLElement | null
    if (el && el.clientHeight > 32) {
      // 再让虚拟列表完成首轮 measure / 自动滚动
      await waitAnimationFrames(frames)
      if (options.yieldMacrotask !== false) {
        await waitMs(16)
        await waitAnimationFrames(1)
      }
      break
    }
    await waitMs(32)
  }

  const elapsed = performance.now() - startedAt
  if (elapsed < minMs) {
    await waitMs(minMs - elapsed)
  }
  await waitAnimationFrames(1)
}
