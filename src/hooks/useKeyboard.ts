import { useEffect } from 'react'
import { usePlayerStore } from '../stores/playerStore'

interface UseKeyboardOptions {
  onPlay: () => void
  onPause: () => void
  onStop: () => void
}

/**
 * App-level keyboard shortcuts (仅窗口内、且焦点不在输入框时生效)。
 * 注意：方向键的「上一句/下一句」导航**不再**由本钩子处理 —— 已由全局快捷键
 * （默认 Ctrl+Alt+方向键，可在设置中改）统一接管，避免两者叠加导致一次按键跳两句。
 * 若在此处保留无修饰键的方向键绑定，按 Ctrl+方向键时会同时触发内部与全局两份逻辑。
 */
export function useKeyboard({
  onPlay,
  onPause,
  onStop
}: UseKeyboardOptions) {
  const playState = usePlayerStore((s) => s.playState)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          if (playState === 'playing') onPause()
          else onPlay()
          break
        case 'Escape':
          e.preventDefault()
          onStop()
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [playState, onPlay, onPause, onStop])
}

/**
 * Clipboard hook.
 * - Listens for Ctrl+V to paste text and start reading
 */
interface UseClipboardOptions {
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
  onStartReadingText: (text: string) => void
}

export function useClipboardHotkey({ showToast, onStartReadingText }: UseClipboardOptions) {
  useEffect(() => {
    // Paste handler
    const handlePaste = (e: ClipboardEvent) => {
      // Only auto-detect when main window is focused (per PRD: "if 听伴窗口在前台")
      if (!document.hasFocus()) return

      const text = e.clipboardData?.getData('text') || ''
      if (!text || text.trim().length === 0) return
      if (text.length > 50000) return

      // Show a toast offering to read the text
      showToast('info', `检测到文本（${text.length}字），可点击朗读`)
    }

    document.addEventListener('paste', handlePaste)

    return () => {
      document.removeEventListener('paste', handlePaste)
    }
  }, [showToast, onStartReadingText])
}
