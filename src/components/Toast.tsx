import { useEffect, useState, useCallback } from 'react'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import type { ToastItem } from '../global'

interface ToastContainerProps {
  toasts: ToastItem[]
  onRemove: (id: string) => void
}

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info
}

const colorMap = {
  success: 'bg-green-500',
  error: 'bg-red-500',
  warning: 'bg-yellow-500',
  info: 'bg-blue-500'
}

export default function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  )
}

function Toast({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false)
  const Icon = iconMap[toast.type]

  useEffect(() => {
    const duration = toast.duration || 3000
    const exitTimer = setTimeout(() => {
      setIsExiting(true)
      setTimeout(() => onRemove(toast.id), 300)
    }, duration)
    return () => clearTimeout(exitTimer)
  }, [toast.id, toast.duration, onRemove])

  const handleClose = useCallback(() => {
    setIsExiting(true)
    setTimeout(() => onRemove(toast.id), 300)
  }, [toast.id, onRemove])

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg
        bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
        min-w-[280px] max-w-[400px]
        ${isExiting ? 'toast-exit' : 'toast-enter'}`}
    >
      <div className={`w-6 h-6 rounded-full ${colorMap[toast.type]} flex items-center justify-center flex-shrink-0`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <span className="text-sm text-gray-800 dark:text-gray-200 flex-1">
        {toast.message}
      </span>
      <button
        onClick={handleClose}
        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
