import type { ShortcutAction } from './global'

/** 快捷键动作清单（围绕播放器） */
export const SHORTCUT_ACTION_LIST: Array<{
  key: ShortcutAction
  label: string
  description: string
}> = [
  { key: 'toggle', label: '播放 / 暂停', description: '切换播放与暂停状态' },
  { key: 'stop', label: '停止', description: '停止当前朗读' },
  { key: 'prevSentence', label: '上一句', description: '跳到上一句' },
  { key: 'nextSentence', label: '下一句', description: '跳到下一句' },
  { key: 'prevChapter', label: '上一章 / 页', description: '翻到上一章或上一页' },
  { key: 'nextChapter', label: '下一章 / 页', description: '翻到下一章或下一页' },
  { key: 'speedUp', label: '倍速 +', description: '提高朗读倍速（+0.25x）' },
  { key: 'speedDown', label: '倍速 −', description: '降低朗读倍速（−0.25x）' },
  { key: 'volumeUp', label: '音量 +', description: '增大音量（+5%）' },
  { key: 'volumeDown', label: '音量 −', description: '减小音量（−5%）' },
  { key: 'resetDefaults', label: '恢复默认', description: '倍速与音量恢复默认（1.0x / 80%）' }
]

/** 默认快捷键（跨平台用 CommandOrControl，Windows 下即 Ctrl） */
export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  toggle: 'CommandOrControl+Alt+P',
  stop: 'CommandOrControl+Alt+S',
  prevSentence: 'CommandOrControl+Alt+Left',
  nextSentence: 'CommandOrControl+Alt+Right',
  prevChapter: 'CommandOrControl+Alt+Up',
  nextChapter: 'CommandOrControl+Alt+Down',
  speedUp: 'CommandOrControl+Alt+]',
  speedDown: 'CommandOrControl+Alt+[',
  volumeUp: 'CommandOrControl+Alt+=',
  volumeDown: 'CommandOrControl+Alt+-',
  resetDefaults: 'CommandOrControl+Alt+0'
}

/** 用默认值补全（缺省动作回退到默认，显式空串表示「禁用」） */
export function normalizeShortcuts(s?: Partial<Record<ShortcutAction, string>>): Record<ShortcutAction, string> {
  const out = { ...DEFAULT_SHORTCUTS }
  if (s) {
    for (const item of SHORTCUT_ACTION_LIST) {
      const v = s[item.key]
      if (v !== undefined) out[item.key] = v
    }
  }
  return out
}

/** 与 DOM KeyboardEvent 同形的最小结构（避免 Electron 主进程依赖 DOM 类型） */
interface KeyEventLike {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  key: string
}

/** 把一次键盘事件转换为 Electron 加速器字符串（用于捕获设置） */
export function keyToAccelerator(e: KeyEventLike): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('CommandOrControl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  if (e.metaKey) parts.push('Super')

  let key = e.key
  if (key === ' ' || key === 'Spacebar') key = 'Space'
  else if (key === 'ArrowLeft') key = 'Left'
  else if (key === 'ArrowRight') key = 'Right'
  else if (key === 'ArrowUp') key = 'Up'
  else if (key === 'ArrowDown') key = 'Down'
  else if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) key = '' // 仅有修饰键，等待主键
  else if (key.length === 1) key = key.toUpperCase()
  // 其余（F1-F12 / Enter / Escape / Media* 等）保持原样

  // 仅有修饰键（如单独按下 Ctrl）时返回空串，等待主键，
  // 否则按下 Ctrl 的瞬间会被误判为完整的快捷键而直接结算
  if (!key) return ''
  parts.push(key)
  return parts.join('+')
}

/** 检查加速器是否至少含一个修饰键（避免误吞单键） */
export function requiresModifier(acc: string): boolean {
  return /(CommandOrControl|Ctrl|Cmd|Alt|Shift|Super)/.test(acc)
}

/** 判断一次按键是否为纯修饰键（Ctrl/Shift/Alt/Meta 等） */
export function isModifierKey(key: string): boolean {
  return ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(key)
}

/**
 * 捕获按键时的「实时预览」：仅按下修饰键（还没按主键）时，
 * 返回已按住的修饰键组合（如 "CommandOrControl+Alt"），供 UI 显示"按到一半"的状态。
 * 与 keyToAccelerator 的区别：修饰键单独按下时不返回空串，而是返回已累积的修饰键。
 */
export function acceleratorPreview(e: KeyEventLike): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('CommandOrControl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  if (e.metaKey) parts.push('Super')
  return parts.join('+')
}

/** 把加速器里的单个 token 转成简短、美观的展示文案 */
const KEY_LABEL_MAP: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  CmdOrCtrl: 'Ctrl',
  Control: 'Ctrl',
  Command: 'Cmd',
  Cmd: 'Cmd',
  Super: 'Win',
  Meta: 'Win',
  Option: 'Alt',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  Space: '␣',
  Escape: 'Esc',
  Return: '↵',
  Enter: '↵',
  Delete: 'Del',
  Backspace: '⌫',
  Plus: '+',
  '=': '+'
}

/** 把加速器字符串拆成一组简短键帽文案，供 UI 以 chip 形式展示 */
export function acceleratorToKeys(acc: string): string[] {
  if (!acc) return []
  return acc
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => KEY_LABEL_MAP[t] ?? t)
}
