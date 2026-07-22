import { create } from 'zustand'

export type OsdKind = 'speed' | 'volume' | 'reset'

interface OsdState {
  visible: boolean
  kind: OsdKind
  /** 触发一次 OSD 显示，自动在 1.2s 后隐藏 */
  show: (kind: OsdKind) => void
  hide: () => void
}

let hideTimer: ReturnType<typeof setTimeout> | null = null
const OSD_DURATION = 1200

export const useOsdStore = create<OsdState>((set) => ({
  visible: false,
  kind: 'speed',
  show: (kind) => {
    if (hideTimer) clearTimeout(hideTimer)
    set({ visible: true, kind })
    hideTimer = setTimeout(() => set({ visible: false }), OSD_DURATION)
  },
  hide: () => {
    if (hideTimer) clearTimeout(hideTimer)
    set({ visible: false })
  }
}))
