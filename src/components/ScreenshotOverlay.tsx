import { useEffect, useRef, useState, useCallback } from 'react'
import { Check, X } from 'lucide-react'

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

type HandleDir = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'

const HANDLE_SIZE = 8
const MAG_SIZE = 140
const MAG_SCALE = 3
const MIN_SELECT = 6

/**
 * 截图选区组件。
 *
 * 交互流程（两击式框选）：
 * 1. 进入 → 显示全屏截图背景 + 十字准星 + 放大镜
 * 2. 第一击 → 设定起点（锚点）
 * 3. 移动鼠标 → 选区随光标扩张（橡皮筋）
 * 4. 第二击 → 确定范围，进入调整模式（镂空蒙版 + 实时尺寸）
 * 5. 调整模式下可拖动 8 点把手缩放、拖选区内移动
 * 6. 点 ✓ → 提交 OCR，点 ✗ 或 Esc → 取消
 */
export default function ScreenshotOverlay() {
  const [bgDataUrl, setBgDataUrl] = useState('')
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null)
  const [confirmed, setConfirmed] = useState(false) // 松手后进入调整模式
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [dragMode, setDragMode] = useState<'none' | 'move' | HandleDir>('none')
  const [dragAnchor, setDragAnchor] = useState<{ x: number; y: number; rect: Rect } | null>(null)
  const magnifierCanvasRef = useRef<HTMLCanvasElement>(null)

  // 加载背景截图
  useEffect(() => {
    void window.api?.getScreenshotDataUrl().then((url) => {
      if (url) setBgDataUrl(url)
    })
  }, [])

  // 预加载 Image 对象供 Canvas 放大镜用
  useEffect(() => {
    if (!bgDataUrl) return
    const img = new Image()
    img.onload = () => setBgImage(img)
    img.src = bgDataUrl
  }, [bgDataUrl])

  // 放大镜渲染
  useEffect(() => {
    if (!bgImage || !magnifierCanvasRef.current) return
    const canvas = magnifierCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const srcW = MAG_SIZE / MAG_SCALE
    const srcH = MAG_SIZE / MAG_SCALE
    const sx = mousePos.x - srcW / 2
    const sy = mousePos.y - srcH / 2

    ctx.clearRect(0, 0, MAG_SIZE, MAG_SIZE)
    // 绘制放大的背景区域
    ctx.drawImage(bgImage, sx, sy, srcW, srcH, 0, 0, MAG_SIZE, MAG_SIZE)

    // 像素网格
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 0.5
    for (let i = 0; i <= MAG_SCALE; i++) {
      const pos = (i / MAG_SCALE) * MAG_SIZE
      ctx.beginPath(); ctx.moveTo(pos, 0); ctx.lineTo(pos, MAG_SIZE); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(MAG_SIZE, pos); ctx.stroke()
    }

    // 十字准星
    const cx = MAG_SIZE / 2
    const cy = MAG_SIZE / 2
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, MAG_SIZE); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(MAG_SIZE, cy); ctx.stroke()
  }, [bgImage, mousePos])

  // Esc 取消
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void window.api?.cancelOcrSelection()
      }
      if (e.key === 'Enter' && confirmed) {
        handleConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmed])

  // 计算选区矩形
  const getRect = useCallback((): Rect | null => {
    if (!start) return null
    const pt = current || start
    const left = Math.min(start.x, pt.x)
    const top = Math.min(start.y, pt.y)
    const width = Math.abs(pt.x - start.x)
    const height = Math.abs(pt.y - start.y)
    return { left, top, width, height }
  }, [start, current])

  const rect = (() => {
    const r = getRect()
    if (!r) return null
    // 太小视为未选区
    if (r.width < MIN_SELECT || r.height < MIN_SELECT) return null
    return r
  })()

  // === 鼠标事件 ===

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return

    // 确认模式：点选区内 → 移动选区；点选区外 → 重新开始框选（第一击）
    if (confirmed && rect) {
      if (e.clientX >= rect.left && e.clientX <= rect.left + rect.width &&
          e.clientY >= rect.top && e.clientY <= rect.top + rect.height) {
        setDragMode('move')
        setDragAnchor({ x: e.clientX, y: e.clientY, rect })
        return
      }
      setConfirmed(false)
      setStart({ x: e.clientX, y: e.clientY })
      setCurrent({ x: e.clientX, y: e.clientY })
      return
    }

    // 未确认模式：第一击设锚点，第二击确定范围（两击式框选）
    if (!start) {
      setConfirmed(false)
      setStart({ x: e.clientX, y: e.clientY })
      setCurrent({ x: e.clientX, y: e.clientY })
      return
    }
    // 第二击 → 确定范围并进入调整模式
    const r = getRect()
    if (r && r.width >= MIN_SELECT && r.height >= MIN_SELECT) {
      setConfirmed(true)
    } else {
      // 太小（几乎没移动）→ 回到空闲，允许重选
      setStart(null)
      setCurrent(null)
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY })

    // 拖拽移动选区
    if (dragMode === 'move' && dragAnchor) {
      const dx = e.clientX - dragAnchor.x
      const dy = e.clientY - dragAnchor.y
      setStart({ x: dragAnchor.rect.left + dx, y: dragAnchor.rect.top + dy })
      setCurrent({
        x: dragAnchor.rect.left + dragAnchor.rect.width + dx,
        y: dragAnchor.rect.top + dragAnchor.rect.height + dy
      })
      return
    }

    // 拖拽缩放把手
    if (dragMode !== 'none' && dragAnchor) {
      applyResize(e.clientX, e.clientY)
      return
    }

    // 正在框选
    if (start) {
      setCurrent({ x: e.clientX, y: e.clientY })
    }
  }

  const handleMouseUp = () => {
    // 仅处理调整模式下的拖拽（移动/缩放把手）
    if (dragMode !== 'none') {
      setDragMode('none')
      setDragAnchor(null)
      if (rect && rect.width >= MIN_SELECT && rect.height >= MIN_SELECT) {
        setConfirmed(true)
      }
      return
    }
    // 框选阶段用「两击式」：第二击已在 mousedown 中确定范围，这里不再处理
  }

  // === 缩放把手拖拽 ===
  const startHandleDrag = (dir: HandleDir, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!rect) return
    setDragMode(dir)
    setDragAnchor({ x: e.clientX, y: e.clientY, rect })
  }

  const applyResize = (cx: number, cy: number) => {
    if (!dragAnchor || dragMode === 'none' || dragMode === 'move') return
    const { rect: r } = dragAnchor
    const dx = cx - dragAnchor.x
    const dy = cy - dragAnchor.y
    let { left, top, width, height } = r

    if (dragMode.includes('e')) { width = Math.max(MIN_SELECT, r.width + dx) }
    if (dragMode.includes('w')) { left = r.left + dx; width = Math.max(MIN_SELECT, r.width - dx) }
    if (dragMode.includes('s')) { height = Math.max(MIN_SELECT, r.height + dy) }
    if (dragMode.includes('n')) { top = r.top + dy; height = Math.max(MIN_SELECT, r.height - dy) }

    setStart({ x: left, y: top })
    setCurrent({ x: left + width, y: top + height })
  }

  // === 确认 / 取消 ===
  const handleConfirm = useCallback(async () => {
    if (!rect || !bgDataUrl) return
    try {
      await window.api?.submitOcrSelection({
        dataUrl: bgDataUrl,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      })
    } catch {
      void window.api?.cancelOcrSelection()
    }
  }, [rect, bgDataUrl])

  const handleCancel = () => {
    void window.api?.cancelOcrSelection()
  }

  // === 渲染 ===
  if (!bgDataUrl) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
        <div className="text-white text-sm">正在捕获屏幕...</div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 select-none"
      style={{ cursor: confirmed ? 'default' : 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* 截图背景 */}
      <img
        src={bgDataUrl}
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
        alt=""
      />

      {/* 四块暗蒙版（镂空选区） */}
      {rect && (
        <>
          <div className="absolute bg-black/50" style={{ top: 0, left: 0, right: 0, height: rect.top }} />
          <div className="absolute bg-black/50" style={{ top: rect.top + rect.height, left: 0, right: 0, bottom: 0 }} />
          <div className="absolute bg-black/50" style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }} />
          <div className="absolute bg-black/50" style={{ top: rect.top, left: rect.left + rect.width, right: 0, height: rect.height }} />
        </>
      )}

      {/* 选区边框 */}
      {rect && (
        <div
          className="absolute border-2 border-blue-500"
          style={{
            left: rect.left, top: rect.top,
            width: rect.width, height: rect.height,
            boxShadow: '0 0 0 1px rgba(255,255,255,0.2), inset 0 0 0 1px rgba(255,255,255,0.1)',
            cursor: dragMode === 'move' ? 'grabbing' : 'grab'
          }}
        >
          {/* 尺寸标签（框选时显示） */}
          {!confirmed && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs px-2 py-0.5 rounded whitespace-nowrap shadow">
              {Math.round(rect.width)} × {Math.round(rect.height)}
            </div>
          )}

          {/* 8 点缩放把手（确认模式） */}
          {confirmed && (
            <>
              {(['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as HandleDir[]).map((dir) => {
                const style: React.CSSProperties = {
                  position: 'absolute',
                  width: HANDLE_SIZE, height: HANDLE_SIZE,
                  background: '#fff',
                  border: '2px solid #3b82f6',
                  borderRadius: dir.length === 2 ? '2px' : '2px',
                  cursor: `${dir}-resize`,
                  zIndex: 10,
                  transform: 'translate(-50%, -50%)'
                }
                if (dir.includes('n')) style.top = 0
                if (dir.includes('s')) style.top = '100%'
                if (!dir.includes('n') && !dir.includes('s')) style.top = '50%'
                if (dir.includes('w')) style.left = 0
                if (dir.includes('e')) style.left = '100%'
                if (!dir.includes('w') && !dir.includes('e')) style.left = '50%'
                return (
                  <div
                    key={dir}
                    style={style}
                    onMouseDown={(e) => startHandleDrag(dir, e)}
                  />
                )
              })}
            </>
          )}
        </div>
      )}

      {/* 确认工具栏 */}
      {confirmed && rect && (
        <div
          className="absolute flex items-center gap-1 bg-gray-900/90 border border-gray-700 rounded-lg px-1.5 py-1 shadow-xl z-20"
          style={{
            left: rect.left + rect.width,
            top: rect.top + rect.height + 8,
            transform: 'translateX(-100%)'
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleCancel}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-1.5 rounded-md hover:bg-red-500/20 text-gray-300 hover:text-red-400 transition-colors"
            title="取消 (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
          <button
            onClick={handleConfirm}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-1.5 rounded-md hover:bg-green-500/20 text-gray-300 hover:text-green-400 transition-colors"
            title="确认 OCR"
          >
            <Check className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* 放大镜（框选模式下 + 未确认） */}
      {!confirmed && bgImage && (
        <canvas
          ref={magnifierCanvasRef}
          width={MAG_SIZE}
          height={MAG_SIZE}
          className="absolute rounded-full border-2 border-blue-500 shadow-xl z-30 pointer-events-none"
          style={{
            left: mousePos.x + 24,
            top: mousePos.y - MAG_SIZE - 24,
            width: MAG_SIZE,
            height: MAG_SIZE,
            borderRadius: '50%'
          }}
        />
      )}

      {/* 顶部提示 */}
      {!confirmed && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-4 py-2 rounded-full pointer-events-none z-20 shadow-lg">
          点击设定起点 · 移动鼠标扩张选区 · 再次点击确定范围 · Esc 取消
        </div>
      )}

      {/* 确认模式顶部提示 */}
      {confirmed && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-blue-500/90 text-white text-sm px-4 py-2 rounded-full pointer-events-none z-20 shadow-lg">
          拖动把手调整大小 · 拖动选区内移动 · 点击 ✓ 确认 / ✗ 取消
        </div>
      )}
    </div>
  )
}
