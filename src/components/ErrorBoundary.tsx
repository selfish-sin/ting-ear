import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] uncaught render error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-white dark:bg-dark-bg text-gray-700 dark:text-gray-300 p-8">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-bold text-red-500 mb-4">页面出错了</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              渲染过程发生未预期的错误。请尝试重启应用。
            </p>
            <pre className="text-xs text-left bg-gray-100 dark:bg-gray-800 p-3 rounded-lg overflow-auto max-h-32 mb-4">
              {this.state.error?.message}
            </pre>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 transition-colors"
            >
              尝试恢复
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
