import { Gauge, Volume2, VolumeX, RotateCcw } from 'lucide-react'
import { useOsdStore } from '../stores/osdStore'
import { usePlayerStore, SPEED_MIN, SPEED_MAX } from '../stores/playerStore'

/**
 * 全局快捷键调节倍速 / 音量时的 OSD 视觉反馈。
 * 仅在快捷键触发时短暂出现（由 osdStore 控制显隐），不影响正常操作。
 */
export default function PlayerOSD() {
  const visible = useOsdStore((s) => s.visible)
  const kind = useOsdStore((s) => s.kind)
  const speed = usePlayerStore((s) => s.speed)
  const volume = usePlayerStore((s) => s.volume)
  const isMuted = usePlayerStore((s) => s.isMuted)

  if (!visible) return null

  const osd = (() => {
    if (kind === 'speed') {
      return {
        Icon: Gauge,
        text: `${speed.toFixed(2)}x`,
        barRatio: (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)
      }
    }
    if (kind === 'volume') {
    const muted = isMuted || volume === 0
      return {
        Icon: muted ? VolumeX : Volume2,
        text: `${Math.round(volume * 100)}%`,
        barRatio: volume
      }
    }
    return {
      Icon: RotateCcw,
      text: '已恢复默认',
      barRatio: null
    }
  })()

  const { Icon, text, barRatio } = osd

  return (
    <div className="fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] pointer-events-none">
      <div className="flex flex-col items-center gap-2 px-7 py-5 rounded-2xl bg-black/70 text-white shadow-2xl backdrop-blur-sm osd-enter min-w-[180px]">
        <Icon className="w-8 h-8" />
        <div className="text-2xl font-semibold tabular-nums">{text}</div>
        {barRatio !== null && (
          <div className="w-40 h-1.5 rounded-full bg-white/20 overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-150"
              style={{ width: `${Math.max(0, Math.min(1, barRatio)) * 100}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
