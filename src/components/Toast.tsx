import { useEffect, useState, useCallback } from 'react'
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import type { ToastItem } from '../global'

interface ToastContainerProps {
  toasts: ToastItem[]
  onRemove: (id: string) => void
}

const iconMap = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info
}

const styleMap = {
  success: {
    icon: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    bar: 'bg-emerald-500'
  },
  error: {
    icon: 'bg-red-500/15 text-red-600 dark:text-red-400',
    bar: 'bg-red-500'
  },
  warning: {
    icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    bar: 'bg-amber-500'
  },
  info: {
    icon: 'bg-primary/15 text-primary',
    bar: 'bg-primary'
  }
}

export default function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed top-12 right-4 z-50 flex flex-col gap-2.5 pointer-events-none">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  )
}

function Toast({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false)
  const Icon = iconMap[toast.type]
  const styles = styleMap[toast.type]

  useEffect(() => {
    const duration = toast.duration || 3000
    const exitTimer = setTimeout(() => {
      setIsExiting(true)
      setTimeout(() => onRemove(toast.id), 280)
    }, duration)
    return () => clearTimeout(exitTimer)
  }, [toast.id, toast.duration, onRemove])

  const handleClose = useCallback(() => {
    setIsExiting(true)
    setTimeout(() => onRemove(toast.id), 280)
  }, [toast.id, onRemove])

  return (
    <div
      className={`pointer-events-auto relative overflow-hidden flex items-center gap-3
        pl-3 pr-2 py-2.5 rounded-2xl min-w-[280px] max-w-[400px]
        bg-white/90 dark:bg-dark-raised/95
        border border-gray-200/80 dark:border-dark-border
        shadow-card backdrop-blur-md
        ${isExiting ? 'toast-exit' : 'toast-enter'}`}
    >
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${styles.icon}`}>
        <Icon className="w-4 h-4" strokeWidth={2.2} />
      </div>
      <span className="text-[13px] leading-snug text-gray-800 dark:text-gray-100 flex-1 font-medium">
        {toast.message}
      </span>
      <button
        onClick={handleClose}
        className="icon-btn-sm flex-shrink-0"
        aria-label="关闭"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <div className={`absolute bottom-0 left-0 right-0 h-0.5 opacity-80 ${styles.bar}`} />
    </div>
  )
}
