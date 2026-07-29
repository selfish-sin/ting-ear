import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  SHORTCUT_ACTION_LIST,
  keyToAccelerator,
  acceleratorToKeys,
  acceleratorPreview,
  isModifierKey,
  requiresModifier
} from '../../shortcuts'
import type { ShortcutAction } from '../../global'
import type { SettingsToast } from './GeneralSettingsPanel'

interface Props {
  showToast: SettingsToast
}

export default function ShortcutsSettingsPanel({ showToast }: Props) {
  const { settings, setShortcuts } = useSettingsStore()
  const [capturingKey, setCapturingKey] = useState<ShortcutAction | null>(null)
  const [previewAcc, setPreviewAcc] = useState('')

  useEffect(() => {
    if (!capturingKey) return
    window.api?.applyShortcuts({})
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturingKey(null)
        setPreviewAcc('')
        showToast('info', '已取消设置')
        return
      }
      if (isModifierKey(e.key)) {
        setPreviewAcc(acceleratorPreview(e))
        return
      }
      const acc = keyToAccelerator(e)
      if (!acc) return
      if (!requiresModifier(acc)) {
        showToast('warning', '快捷键需包含 Ctrl / Alt / Shift 等修饰键')
        return
      }
      setShortcuts({ ...(useSettingsStore.getState().settings.shortcuts || {}), [capturingKey]: acc })
      setPreviewAcc('')
      setCapturingKey(null)
      showToast('success', `已设置：${acc}`)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.api?.applyShortcuts((useSettingsStore.getState().settings.shortcuts || {}) as Record<string, string>)
    }
  }, [capturingKey, setShortcuts, showToast])

  return (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">全局快捷键</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    即使焦点在其它窗口，也能控制听伴播放。修改即时生效并自动保存。
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShortcuts({})
                    showToast('success', '已恢复默认快捷键')
                  }}
                  className="shrink-0 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  恢复默认
                </button>
              </div>

              <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
                {SHORTCUT_ACTION_LIST.map((item) => {
                  const current = settings.shortcuts?.[item.key] || ''
                  const isCapturing = capturingKey === item.key
                  return (
                    <div key={item.key} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-sm text-gray-700 dark:text-gray-200">{item.label}</div>
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{item.description}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            if (isCapturing) {
                              // 再次点击正在捕获的条目 → 取消捕获
                              setCapturingKey(null)
                              setPreviewAcc('')
                              showToast('info', '已取消设置')
                            } else {
                              setPreviewAcc('')
                              setCapturingKey(item.key)
                            }
                          }}
                          onDoubleClick={() => {
                            // 双击已设置的条目 → 直接清空该快捷键（仅在非捕获态）
                            if (isCapturing || !current) return
                            setShortcuts({ ...(settings.shortcuts || {}), [item.key]: '' })
                            showToast('info', `已清除「${item.label}」`)
                          }}
                          title={isCapturing ? '再次点击取消' : current ? '单击重新设置 · 双击清除' : '单击设置快捷键'}
                          className={`min-w-[130px] h-9 px-3 rounded-lg border transition-all duration-150 flex items-center justify-center gap-1 ${
                            isCapturing
                              ? 'border-primary bg-primary/10 text-primary animate-capture'
                              : 'border-gray-200 dark:border-gray-700 hover:border-primary/40 hover:scale-[1.02] active:scale-[0.98]'
                          }`}
                        >
                          {isCapturing ? (
                            previewAcc ? (
                              <span className="flex items-center gap-1">
                                {acceleratorToKeys(previewAcc).map((k, i) => (
                                  <kbd
                                    key={i}
                                    className="inline-flex items-center justify-center min-w-[22px] h-6 px-1.5 rounded-md text-xs font-medium
                                      bg-primary/15 text-primary border border-primary/30 shadow-sm"
                                  >
                                    {k}
                                  </kbd>
                                ))}
                                <span className="text-[11px] text-primary/70 ml-0.5">…</span>
                              </span>
                            ) : (
                              <span className="text-xs text-primary">按下快捷键…</span>
                            )
                          ) : current ? (
                            acceleratorToKeys(current).map((k, i) => (
                              <kbd
                                key={i}
                                className="inline-flex items-center justify-center min-w-[22px] h-6 px-1.5 rounded-md text-xs font-medium
                                  bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200
                                  border border-gray-200 dark:border-gray-600 shadow-sm"
                              >
                                {k}
                              </kbd>
                            ))
                          ) : (
                            <span className="text-xs text-gray-400">未设置</span>
                          )}
                        </button>
                        {current && !isCapturing && (
                          <button
                            onClick={() => {
                              const next = { ...(settings.shortcuts || {}), [item.key]: '' }
                              setShortcuts(next)
                            }}
                            title="清除此快捷键"
                            className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                提示：建议搭配 Ctrl / Alt / Shift 等修饰键，避免与系统或其它软件冲突。
                单击条目后直接按下想要的按键组合即可，按住修饰键时会实时预览；
                再次单击正在捕获的条目、或按 Esc 可取消；双击已设置的条目可快速清除。
              </p>
            </div>
  )
}
