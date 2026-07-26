import { useEffect, useRef, useState, useCallback } from 'react'
import { Check, X, RotateCcw } from 'lucide-react'

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

type HandleDir = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'

const HANDLE_SIZE = 9
const MAG_SIZE = 128
const MAG_SCALE = 2.5
const MIN_SELECT = 8

/**
 * 截图选区（拖拽框选）：
 * 1. 按下拖动 → 实时框选
 * 2. 松手 → 进入调整模式（把手缩放 / 拖移）
 * 3. Enter 或 ✓ → OCR；Esc 或 ✗ → 取消
 */
export default function ScreenshotOverlay() {
  const [bgDataUrl, setBgDataUrl] = useState('')
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [dragMode, setDragMode] = useState<'none' | 'move' | HandleDir>('none')
  const [dragAnchor, setDragAnchor] = useState<{ x: number; y: number; rect: Rect } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const magnifierCanvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    void window.api?.getScreenshotDataUrl().then((url) => {
      if (url) setBgDataUrl(url)
    })
  }, [])

  useEffect(() => {
    if (!bgDataUrl) return
    const img = new Image()
    img.onload = () => setBgImage(img)
    img.src = bgDataUrl
  }, [bgDataUrl])

  // 放大镜
  useEffect(() => {
    if (!bgImage || !magnifierCanvasRef.current || confirmed) return
    const canvas = magnifierCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const srcW = MAG_SIZE / MAG_SCALE
    const srcH = MAG_SIZE / MAG_SCALE
    const sx = mousePos.x - srcW / 2
    const sy = mousePos.y - srcH / 2

    // 将 CSS 坐标映射到图片像素
    const scaleX = bgImage.naturalWidth / window.innerWidth
    const scaleY = bgImage.naturalHeight / window.innerHeight

    ctx.clearRect(0, 0, MAG_SIZE, MAG_SIZE)
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, MAG_SIZE, MAG_SIZE)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      bgImage,
      sx * scaleX,
      sy * scaleY,
      srcW * scaleX,
      srcH * scaleY,
      0,
      0,
      MAG_SIZE,
      MAG_SIZE
    )

    const cx = MAG_SIZE / 2
    const cy = MAG_SIZE / 2
    ctx.strokeStyle = 'rgba(79,110,247,0.9)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx, MAG_SIZE)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, cy)
    ctx.lineTo(MAG_SIZE, cy)
    ctx.stroke()
  }, [bgImage, mousePos, confirmed])

  const getRect = useCallback((): Rect | null => {
    if (!start || !current) return null
    const left = Math.min(start.x, current.x)
    const top = Math.min(start.y, current.y)
    const width = Math.abs(current.x - start.x)
    const height = Math.abs(current.y - start.y)
    if (width < MIN_SELECT || height < MIN_SELECT) return null
    return { left, top, width, height }
  }, [start, current])

  const rect = getRect()

  const handleConfirm = useCallback(async () => {
    if (!rect || !bgDataUrl || submitting) return
    setSubmitting(true)
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
  }, [rect, bgDataUrl, submitting])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void window.api?.cancelOcrSelection()
      }
      if ((e.key === 'Enter' || e.key === ' ') && confirmed && !submitting) {
        e.preventDefault()
        void handleConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmed, submitting, handleConfirm])

  const clampPoint = (x: number, y: number) => ({
    x: Math.max(0, Math.min(window.innerWidth, x)),
    y: Math.max(0, Math.min(window.innerHeight, y))
  })

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || submitting) return
    const p = clampPoint(e.clientX, e.clientY)

    if (confirmed && rect) {
      const inside =
        p.x >= rect.left &&
        p.x <= rect.left + rect.width &&
        p.y >= rect.top &&
        p.y <= rect.top + rect.height
      if (inside) {
        setDragMode('move')
        setDragAnchor({ x: p.x, y: p.y, rect })
        return
      }
      // 点选区外：重新拖选
      setConfirmed(false)
      setSelecting(true)
      setStart(p)
      setCurrent(p)
      return
    }

    setConfirmed(false)
    setSelecting(true)
    setStart(p)
    setCurrent(p)
  }

  const applyResize = (cx: number, cy: number) => {
    if (!dragAnchor || dragMode === 'none' || dragMode === 'move') return
    const { rect: r } = dragAnchor
    const dx = cx - dragAnchor.x
    const dy = cy - dragAnchor.y
    let { left, top, width, height } = r

    if (dragMode.includes('e')) width = Math.max(MIN_SELECT, r.width + dx)
    if (dragMode.includes('w')) {
      left = r.left + dx
      width = Math.max(MIN_SELECT, r.width - dx)
    }
    if (dragMode.includes('s')) height = Math.max(MIN_SELECT, r.height + dy)
    if (dragMode.includes('n')) {
      top = r.top + dy
      height = Math.max(MIN_SELECT, r.height - dy)
    }

    // 边界钳制
    left = Math.max(0, left)
    top = Math.max(0, top)
    width = Math.min(width, window.innerWidth - left)
    height = Math.min(height, window.innerHeight - top)

    setStart({ x: left, y: top })
    setCurrent({ x: left + width, y: top + height })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const p = clampPoint(e.clientX, e.clientY)
    setMousePos(p)

    if (dragMode === 'move' && dragAnchor) {
      const dx = p.x - dragAnchor.x
      const dy = p.y - dragAnchor.y
      let left = dragAnchor.rect.left + dx
      let top = dragAnchor.rect.top + dy
      const w = dragAnchor.rect.width
      const h = dragAnchor.rect.height
      left = Math.max(0, Math.min(left, window.innerWidth - w))
      top = Math.max(0, Math.min(top, window.innerHeight - h))
      setStart({ x: left, y: top })
      setCurrent({ x: left + w, y: top + h })
      return
    }

    if (dragMode !== 'none' && dragMode !== 'move') {
      applyResize(p.x, p.y)
      return
    }

    if (selecting && start) {
      setCurrent(p)
    }
  }

  const handleMouseUp = () => {
    if (dragMode !== 'none') {
      setDragMode('none')
      setDragAnchor(null)
      if (getRect()) setConfirmed(true)
      return
    }
    if (selecting) {
      setSelecting(false)
      if (getRect()) setConfirmed(true)
      else {
        setStart(null)
        setCurrent(null)
      }
    }
  }

  const startHandleDrag = (dir: HandleDir, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!rect) return
    setDragMode(dir)
    setDragAnchor({ x: e.clientX, y: e.clientY, rect })
  }

  const handleCancel = () => {
    void window.api?.cancelOcrSelection()
  }

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmed(false)
    setSelecting(false)
    setStart(null)
    setCurrent(null)
    setDragMode('none')
    setDragAnchor(null)
  }

  // 工具栏位置：尽量在选区下方，贴边时翻到上方
  const toolbarStyle = ((): React.CSSProperties => {
    if (!rect) return {}
    const below = rect.top + rect.height + 10
    const placeBelow = below + 48 < window.innerHeight
    const top = placeBelow ? below : Math.max(8, rect.top - 48)
    let left = rect.left + rect.width
    left = Math.max(12, Math.min(left, window.innerWidth - 12))
    return { left, top, transform: 'translateX(-100%)' }
  })()

  if (!bgDataUrl) {
    return (
      <div className="fixed inset-0 bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-white/90">
          <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <div className="text-sm">正在捕获屏幕…</div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 select-none"
      style={{ cursor: selecting || !confirmed ? 'crosshair' : 'default' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* 背景：fill 避免 object-cover 裁切导致坐标错位 */}
      <img
        src={bgDataUrl}
        className="absolute inset-0 w-full h-full"
        style={{ objectFit: 'fill' }}
        draggable={false}
        alt=""
      />

      {/* 暗蒙版镂空 */}
      {rect ? (
        <>
          <div className="absolute bg-black/55" style={{ top: 0, left: 0, right: 0, height: rect.top }} />
          <div
            className="absolute bg-black/55"
            style={{ top: rect.top + rect.height, left: 0, right: 0, bottom: 0 }}
          />
          <div
            className="absolute bg-black/55"
            style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }}
          />
          <div
            className="absolute bg-black/55"
            style={{
              top: rect.top,
              left: rect.left + rect.width,
              right: 0,
              height: rect.height
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
      )}

      {/* 选区 */}
      {rect && (
        <div
          className="absolute border-2 border-primary"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 1px rgba(255,255,255,0.35), 0 0 0 9999px rgba(0,0,0,0.001)',
            cursor: confirmed ? (dragMode === 'move' ? 'grabbing' : 'grab') : 'crosshair'
          }}
        >
          <div className="absolute -top-7 left-0 bg-primary text-white text-[11px] px-2 py-0.5 rounded shadow font-medium tabular-nums">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>

          {confirmed &&
            (['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as HandleDir[]).map((dir) => {
              const style: React.CSSProperties = {
                position: 'absolute',
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                background: '#fff',
                border: '2px solid #4F6EF7',
                borderRadius: 2,
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
                <div key={dir} style={style} onMouseDown={(e) => startHandleDrag(dir, e)} />
              )
            })}
        </div>
      )}

      {/* 工具栏 */}
      {confirmed && rect && (
        <div
          className="absolute flex items-center gap-1 bg-gray-900/95 border border-white/10 rounded-xl px-1.5 py-1 shadow-2xl z-20"
          style={toolbarStyle}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleReset}
            className="p-2 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition-colors"
            title="重新框选"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={handleCancel}
            className="p-2 rounded-lg hover:bg-red-500/25 text-gray-300 hover:text-red-400 transition-colors"
            title="取消 (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={submitting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
            title="识别文字 (Enter)"
          >
            {submitting ? (
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            识别
          </button>
        </div>
      )}

      {/* 放大镜 */}
      {!confirmed && bgImage && (
        <canvas
          ref={magnifierCanvasRef}
          width={MAG_SIZE}
          height={MAG_SIZE}
          className="absolute rounded-full border-2 border-primary shadow-xl z-30 pointer-events-none"
          style={{
            left: Math.min(mousePos.x + 20, window.innerWidth - MAG_SIZE - 8),
            top: Math.max(8, mousePos.y - MAG_SIZE - 20),
            width: MAG_SIZE,
            height: MAG_SIZE
          }}
        />
      )}

      {/* 提示 */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 pointer-events-none z-20">
        <div className="bg-black/75 text-white text-sm px-4 py-2 rounded-full shadow-lg backdrop-blur-sm">
          {submitting
            ? '正在识别…'
            : confirmed
              ? '拖动调整选区 · Enter 识别 · Esc 取消'
              : selecting
                ? '松开鼠标完成框选'
                : '按住拖动框选文字区域 · Esc 取消'}
        </div>
      </div>
    </div>
  )
}
