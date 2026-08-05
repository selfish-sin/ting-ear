import { useEffect, useState } from 'react'
import { ImageIcon, Trash2, Upload } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useIsDark } from '../../hooks/useIsDark'
import { PRESET_BACKGROUNDS } from '../../backgroundPresets'
import {
  DEFAULT_CONTENT_OPACITY,
  DEFAULT_PANEL_OPACITY,
  clampContentOpacity,
  clampPanelOpacity,
  resolvePanelEffect
} from '../../panelSurface'
import { resolveBaseColor } from '../../utils/extractImageColor'
import type { SettingsToast } from './GeneralSettingsPanel'

interface Props {
  showToast: SettingsToast
}

/**
 * 设置 → 背景
 *  ① 底图（无背景 / 预设 / 上传 + 模糊 + 压暗）
 *  ② 底层色（跟日夜 / 取自底图 / 自定义）
 *  ③ 组件浓度 + 毛玻璃
 *  ④ 正文浓度
 */
export default function BackgroundSettingsPanel({ showToast }: Props) {
  const setBackground = useSettingsStore((s) => s.setBackground)
  const background = useSettingsStore((s) => s.settings.background)
  const isDark = useIsDark()

  const [presetThumbs, setPresetThumbs] = useState<Record<string, string>>({})
  const [customThumb, setCustomThumb] = useState<string | null>(null)
  const [uploadingBg, setUploadingBg] = useState(false)

  const baseMode = background?.baseColor ?? 'auto'
  const resolvedBase = resolveBaseColor(baseMode, isDark, background?.baseColorCached)
  const isCustomBase = baseMode !== 'auto' && baseMode !== 'fromImage'
  const glassOn = resolvePanelEffect(background) === 'frost'
  const panelOpacity = clampPanelOpacity(background?.panelOpacity ?? DEFAULT_PANEL_OPACITY)
  const contentOpacity = clampContentOpacity(background?.contentOpacity ?? DEFAULT_CONTENT_OPACITY)
  const dim = typeof background?.overlayOpacity === 'number' ? background.overlayOpacity : 0.55
  const blur = background?.blur ?? 0
  const enabled = background?.enabled === true

  useEffect(() => {
    let cancelled = false
    Promise.all(
      PRESET_BACKGROUNDS.map(async (p) => {
        const url = await window.api?.backgroundResolve('preset', p.id)
        return [p.id, url] as const
      })
    ).then((entries) => {
      if (cancelled) return
      const map: Record<string, string> = {}
      for (const [id, url] of entries) if (url) map[id] = url
      setPresetThumbs(map)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 当前自定义图预览缩略图（按需解析）
  useEffect(() => {
    if (background?.source !== 'custom' || !background?.customPath) {
      setCustomThumb(null)
      return
    }
    let cancelled = false
    void window.api?.backgroundResolve('custom', background.customPath).then((url) => {
      if (!cancelled) setCustomThumb(url)
    })
    return () => {
      cancelled = true
    }
  }, [background?.source, background?.customPath])

  const handleUpload = async () => {
    if (uploadingBg) return
    setUploadingBg(true)
    try {
      const result = await window.api?.backgroundAdd()
      if (result?.success && result.customPath) {
        setBackground({
          source: 'custom',
          customPath: result.customPath,
          enabled: true,
          ...(baseMode === 'fromImage' ? { baseColorCached: null } : {})
        })
        showToast('success', '背景图已上传')
      } else if (result?.error && result.error !== '取消选择') {
        showToast('error', result.error)
      }
    } finally {
      setUploadingBg(false)
    }
  }

  // 当前选中预览：预设 → 缩略图；自定义 → 按需解析；无背景 → 占位
  const activeThumb =
    background?.source === 'preset' && background.presetId
      ? presetThumbs[background.presetId] ?? null
      : background?.source === 'custom'
        ? customThumb
        : null
  const activeTitle =
    background?.source === 'preset' && background.presetId
      ? PRESET_BACKGROUNDS.find((p) => p.id === background.presetId)?.name
      : background?.source === 'custom'
        ? '自定义图片'
        : undefined

  return (
    <div className="space-y-6">
      <p className="text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
        叠层：底层色 → 底图（可选）→ 组件。日夜模式只管文字/控件深浅；背景在这里单独配。
      </p>

      {/* ① 底图 */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">底图</h3>
          <span className="text-[11px] text-gray-400">{enabled ? '已启用' : '未启用'}</span>
        </div>

        {/* 当前选中预览缩略图 */}
        <div className="relative mb-3 h-24 w-full overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          {activeThumb ? (
            <img src={activeThumb} alt={activeTitle ?? ''} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gray-100 dark:bg-gray-800">
              <ImageIcon className="h-5 w-5 text-gray-300" />
              <span className="text-[11px] text-gray-400">无背景</span>
            </div>
          )}
          <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
            {activeTitle ?? '无背景'}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setBackground({ enabled: false })}
            className={`flex h-14 w-20 flex-col items-center justify-center gap-0.5 rounded-lg border-2 text-[10px] transition-all ${
              !enabled
                ? 'border-primary ring-2 ring-primary/30 text-primary'
                : 'border-gray-200 text-gray-400 hover:border-primary/40 hover:text-primary dark:border-gray-700'
            }`}
          >
            无背景
          </button>
          {PRESET_BACKGROUNDS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() =>
                setBackground({
                  source: 'preset',
                  presetId: p.id,
                  enabled: true,
                  ...(baseMode === 'fromImage' ? { baseColorCached: null } : {})
                })
              }
              className={`relative h-14 w-20 overflow-hidden rounded-lg border-2 transition-all ${
                enabled && background?.source === 'preset' && background?.presetId === p.id
                  ? 'border-primary ring-2 ring-primary/30'
                  : 'border-gray-200 hover:border-primary/40 dark:border-gray-700'
              }`}
              title={p.name}
            >
              {presetThumbs[p.id] ? (
                <img src={presetThumbs[p.id]} alt={p.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gray-100 dark:bg-gray-800">
                  <ImageIcon className="h-4 w-4 text-gray-300" />
                </div>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void handleUpload()}
            disabled={uploadingBg}
            className="flex h-14 w-20 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-gray-300 text-[10px] text-gray-400 hover:border-primary/50 hover:text-primary disabled:opacity-50 dark:border-gray-600"
          >
            <Upload className="h-3.5 w-3.5" />
            上传
          </button>
        </div>
        {background?.source === 'custom' && background.customPath && (
          <button
            type="button"
            onClick={async () => {
              const cp = background.customPath
              if (!cp) return
              // 先落到「无背景」有效态，再异步删文件
              setBackground({ source: 'preset', presetId: null, enabled: false })
              await window.api?.backgroundRemove(cp)
              showToast('info', '已删除自定义背景图')
            }}
            className="mt-2 flex items-center gap-1 text-xs text-gray-400 hover:text-red-500"
          >
            <Trash2 className="h-3 w-3" /> 删除当前上传图
          </button>
        )}
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-xs text-gray-500">
              <span>底图模糊</span>
              <span className="tabular-nums text-primary">{blur}px</span>
            </span>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={blur}
              onChange={(e) => setBackground({ blur: parseInt(e.target.value) })}
              className="w-full"
              disabled={!enabled}
            />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-xs text-gray-500">
              <span>底图压暗</span>
              <span className="tabular-nums text-primary">{Math.round(dim * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={dim}
              onChange={(e) => setBackground({ overlayOpacity: parseFloat(e.target.value) })}
              className="w-full"
              disabled={!enabled}
            />
          </label>
        </div>
      </section>

      {/* ② 底层色 */}
      <section>
        <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">底层色</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setBackground({ baseColor: 'auto' })}
            className={`rounded border px-2.5 py-1 text-xs ${
              baseMode === 'auto'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'
            }`}
          >
            跟日夜
          </button>
          <button
            type="button"
            disabled={!enabled}
            onClick={() =>
              setBackground({ baseColor: 'fromImage', baseColorCached: null })
            }
            title={enabled ? undefined : '需先选底图'}
            className={`rounded border px-2.5 py-1 text-xs ${
              baseMode === 'fromImage'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'
            } ${!enabled ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            取自底图
          </button>
          <label
            className={`flex cursor-pointer items-center gap-1.5 rounded border px-2.5 py-1 text-xs ${
              isCustomBase
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'
            }`}
          >
            <input
              type="color"
              value={isCustomBase ? baseMode : resolvedBase}
              onChange={(e) => setBackground({ baseColor: e.target.value.toUpperCase() })}
              className="h-4 w-4 cursor-pointer rounded"
            />
            自定义
          </label>
          <span
            className="ml-1 h-6 w-10 shrink-0 rounded border border-black/10 dark:border-white/15"
            style={{ backgroundColor: resolvedBase }}
            title={resolvedBase}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400">
          {baseMode === 'auto' && '浅/深色主题各用一套默认底色。'}
          {baseMode === 'fromImage' && (
            <>
              从当前底图自动取样。
              {!enabled && <span className="text-red-400"> 需先选底图。</span>}
            </>
          )}
          {isCustomBase && '固定色，不随日夜或底图变化。'}
        </p>
      </section>

      {/* ③ 组件浓度 + 毛玻璃 */}
      <section className="rounded-xl border border-primary/15 bg-primary/[0.04] p-3 dark:border-primary/20 dark:bg-primary/10">
        <h3 className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-200">组件浓度</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-gray-400">
          侧栏 / 工具条 / 卡片的底，与毛玻璃开关并排。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="block min-w-40 flex-1">
            <span className="mb-1 flex items-center justify-between text-xs text-gray-500">
              <span>组件浓度</span>
              <span className="tabular-nums text-primary">{Math.round(panelOpacity * 100)}%</span>
            </span>
            <input
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={panelOpacity}
              onChange={(e) => setBackground({ panelOpacity: parseFloat(e.target.value) })}
              className="w-full"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={glassOn}
              onChange={(e) => setBackground({ glass: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            毛玻璃
            <span className="text-xs text-gray-400">加强模糊</span>
          </label>
        </div>
      </section>

      {/* ④ 正文浓度 */}
      <section>
        <h3 className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-200">正文浓度</h3>
        <p className="mb-2 text-[11px] leading-relaxed text-gray-400">
          AI 阅读 + 听书正文共用（越高字越清楚，仍透出底图色）
        </p>
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-xs text-gray-500">
            <span>阅读正文浓度</span>
            <span className="tabular-nums text-primary">{Math.round(contentOpacity * 100)}%</span>
          </span>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.02}
            value={contentOpacity}
            onChange={(e) => setBackground({ contentOpacity: parseFloat(e.target.value) })}
            className="w-full"
          />
        </label>
      </section>
    </div>
  )
}
