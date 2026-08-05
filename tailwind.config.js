/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,tsx,ts,jsx,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 主色：由 CSS 变量驱动（设置 → 主题色，默认太古蓝 #4F6EF7）
        // --primary-rgb 等在 :root / App 里写入
        primary: {
          DEFAULT: 'rgb(var(--primary-rgb) / <alpha-value>)',
          50: 'rgb(var(--primary-rgb) / 0.06)',
          100: 'rgb(var(--primary-rgb) / 0.12)',
          200: 'rgb(var(--primary-rgb) / 0.25)',
          300: 'rgb(var(--primary-300-rgb) / <alpha-value>)',
          400: 'rgb(var(--primary-rgb) / 0.75)',
          500: 'rgb(var(--primary-rgb) / <alpha-value>)',
          600: 'rgb(var(--primary-600-rgb) / <alpha-value>)',
          700: 'rgb(var(--primary-700-rgb) / <alpha-value>)'
        },
        highlight: '#FEF3C7',
        'sentence-hover': '#F3F4F6',
        // 浅色表面层级
        surface: {
          DEFAULT: '#F8F9FC',
          raised: '#FFFFFF',
          muted: '#F1F3F9'
        },
        // 深色表面层级（偏亮灰蓝，避免发黑）
        'dark-bg': '#1C1F28',
        'dark-surface': '#262A35',
        'dark-raised': '#2F3442',
        'dark-border': '#3E4556',
        'dark-muted': '#2A2F3C'
      },
      fontFamily: {
        sans: [
          '"Segoe UI"',
          '"PingFang SC"',
          '"Microsoft YaHei UI"',
          '"Microsoft YaHei"',
          'system-ui',
          'sans-serif'
        ]
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.04)',
        card: '0 1px 3px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.06)',
        glow: '0 0 0 1px rgb(var(--primary-rgb) / 0.12), 0 8px 24px rgb(var(--primary-rgb) / 0.18)',
        nav: '1px 0 0 rgba(15, 23, 42, 0.04)'
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1rem'
      },
      keyframes: {
        'capture-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(var(--primary-rgb) / 0.45)' },
          '50%': { boxShadow: '0 0 0 7px rgb(var(--primary-rgb) / 0)' }
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        capture: 'capture-pulse 1.4s ease-in-out infinite',
        'fade-up': 'fade-up 0.25s ease-out'
      },
      zIndex: {
        dropdown: '100',
        overlay: '200',
        modal: '300',
        toast: '400',
        osd: '500'
      }
    }
  },
  plugins: []
}
